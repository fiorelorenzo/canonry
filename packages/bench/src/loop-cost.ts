/**
 * What a document's steps actually cost, and where in the resent transcript the money is
 * (issue #271).
 *
 *   pnpm --filter @canonry/bench loop-cost
 *   pnpm --filter @canonry/bench loop-cost -- --source onenote
 *   pnpm --filter @canonry/bench loop-cost -- --documents all
 *
 * Issue #271 measured two real OneNote jobs whose corpora differed by a factor of five and
 * whose first document cost the same within six per cent, and named the two things nobody
 * had checked: which part of the resent transcript the tokens are in, and whether the other
 * playbooks are flat in the same way. This runner answers both, and it answers them by
 * running the product's own loop rather than a model of it: the real `GatewayDriver`, the
 * real playbook, the real tool surface, the real archive reader, against the built corpus.
 *
 * Two documents per source by default, the largest and the smallest the corpus holds for
 * that playbook, because a cost that tracks content and a cost that tracks step count look
 * identical until you vary the content. `--documents all` runs every document a source has,
 * which is a much longer and more expensive run and only worth it for one source at a time.
 *
 * Everything lands in `.data/loop-cost.json` (every sample, so a different breakdown can be
 * computed later without spending again) and `.data/loop-cost.md` (the tables). The
 * conclusion drawn from a run is committed to `docs/loop-cost.md`; the run itself is not,
 * exactly as `docs/models.md` and this package's other runners already work.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	ArchiveSourceReader,
	DEFAULT_ARCHIVE_LIMITS,
	loadBuiltinPlaybook,
	type JobDocument,
	type StepSample
} from '@canonry/import';
import { createDb } from '@canonry/db';
import { resolveModel } from '@canonry/ai';
import { dataDir, loadEnv, requireEnv } from './env.js';
import { archivePath, manifestPath, type CorpusManifest } from './corpus/build.js';
import { benchFixture, topUpCredits } from './fixture.js';
import { runImportDocuments } from './import-run.js';

const ALL_SOURCES = ['obsidian', 'kanka', 'world-anvil', 'pdf', 'docx', 'generic', 'onenote'];

/** Credits for one single-document job. Deliberately far above what a document should cost
 * (issue #271's production measurements are 2.75 to 2.89 credits for one OneNote document)
 * so that a document stops on its playbook's own step ceiling or on `job_finish`, never on
 * the budget gate. A run that stopped at the ceiling would be measuring the ceiling. */
const CREDITS_PER_DOCUMENT = 40;

interface DocumentRun {
	source: string;
	playbookId: string;
	stepBudget: number;
	sourcePath: string;
	/** Characters of text the real `SourceReader` hands the model for this document, which
	 * is the only "document size" the loop can possibly react to. */
	contentChars: number;
	size: 'largest' | 'smallest' | 'other';
	status: string;
	detail: string;
	steps: number;
	entities: number;
	relations: number;
	inputTokens: number;
	outputTokens: number;
	credits: number;
	costEur: number;
	samples: StepSample[];
}

interface LoopCostReport {
	ranAt: string;
	cheapModel: string;
	premiumModel: string;
	revision: 'v1' | 'v2';
	runs: DocumentRun[];
}

function arg(name: string): string | undefined {
	const argv = process.argv.slice(2);
	const at = argv.indexOf(`--${name}`);
	return at >= 0 ? argv[at + 1] : undefined;
}

/** Total characters, ceiling-divided by this repo's 4-chars-per-token convention, so the
 * numbers in the report line up with `gateway-driver.ts`'s own pricing arithmetic. */
function tokensOf(chars: number): number {
	return Math.ceil(chars / 4);
}

async function documentsFor(
	source: string,
	revision: 'v1' | 'v2',
	which: string
): Promise<Array<{ document: JobDocument; contentChars: number; size: DocumentRun['size'] }>> {
	const manifest = JSON.parse(
		readFileSync(manifestPath(source, revision), 'utf8')
	) as CorpusManifest;
	const reader = ArchiveSourceReader.open(
		readFileSync(archivePath(source, revision)),
		DEFAULT_ARCHIVE_LIMITS
	);

	const measured: Array<{ sourcePath: string; contentChars: number }> = [];
	for (const expectation of manifest.documents) {
		try {
			const { content } = await reader.read(expectation.sourcePath);
			measured.push({ sourcePath: expectation.sourcePath, contentChars: content.length });
		} catch {
			// A document whose text the reader cannot produce (a PDF that is all scans) is
			// still a document the loop runs, and its size is honestly unknown rather than
			// zero. Recorded as -1 so the report never plots a guess as a measurement.
			measured.push({ sourcePath: expectation.sourcePath, contentChars: -1 });
		}
	}
	measured.sort((a, b) => b.contentChars - a.contentChars);

	const picked =
		which === 'all'
			? measured
			: measured.length <= 1
				? measured
				: [measured[0]!, measured[measured.length - 1]!];

	return picked.map((entry, index) => ({
		document: { id: `doc-${index + 1}`, sourcePath: entry.sourcePath },
		contentChars: entry.contentChars,
		size:
			which === 'all'
				? 'other'
				: entry.sourcePath === measured[0]!.sourcePath
					? 'largest'
					: 'smallest'
	}));
}

/** The fixed part of a step (the system prompt, the tool schemas, the opening ask) against
 * the part that accumulates (prior tool results, prior tool calls, prior assistant text).
 * The whole question issue #271 asks, per document.
 *
 * `fixedShare` is the one number the fix depends on: the share of a document's *entire*
 * input bill that is the same bytes re-sent on every step. Computed from the estimated
 * split rather than the provider's reported totals, because reported tokens arrive as one
 * number per call and cannot be decomposed; `estimateDrift` is printed next to it so the
 * size of that approximation is visible instead of assumed. */
function split(samples: StepSample[]): {
	fixedTokens: number;
	accumulatedFirst: number;
	accumulatedLast: number;
	toolResultShareLast: number;
	fixedShare: number;
	reportedFixedShare: number;
	estimateDrift: number;
} {
	const first = samples[0];
	const last = samples[samples.length - 1];
	if (!first || !last) {
		return {
			fixedTokens: 0,
			accumulatedFirst: 0,
			accumulatedLast: 0,
			toolResultShareLast: 0,
			fixedShare: 0,
			reportedFixedShare: 0,
			estimateDrift: 0
		};
	}
	const fixedTokens = tokensOf(first.systemPrompt + first.toolSchemas + first.userTurns);
	const accumulated = (sample: StepSample) =>
		tokensOf(sample.assistantText + sample.toolCallArgs + sample.toolResults);
	const estimatedTotal = samples.reduce((sum, s) => sum + s.estimatedInputTokens, 0);
	const reportedTotal = samples.reduce((sum, s) => sum + s.reportedInputTokens, 0);
	return {
		fixedTokens,
		accumulatedFirst: accumulated(first),
		accumulatedLast: accumulated(last),
		toolResultShareLast: last.totalChars === 0 ? 0 : last.toolResults / last.totalChars,
		fixedShare: estimatedTotal === 0 ? 0 : (fixedTokens * samples.length) / estimatedTotal,
		// The same share measured through the provider's own tokenizer instead of
		// chars-over-four, which is the number worth quoting. Step 1 carries the fixed block
		// and nothing else - no tool has run yet - so its reported input tokens *are* the
		// fixed block's real token count, and it is identical on every later step because
		// the bytes are. Multiply by the call count and the resend is priced exactly.
		reportedFixedShare:
			reportedTotal === 0 ? 0 : (first.reportedInputTokens * samples.length) / reportedTotal,
		estimateDrift: reportedTotal === 0 ? 0 : estimatedTotal / reportedTotal - 1
	};
}

function renderStepTable(samples: StepSample[]): string {
	const header =
		'| step | messages | system | tool schemas | user turns | assistant text | tool call args | tool results | est. input tokens | reported input tokens | cache reads |\n' +
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
	const rows = samples.map((sample) => {
		const label = sample.attempt === 0 ? `${sample.step}` : `${sample.step}r${sample.attempt}`;
		return `| ${label} | ${sample.messageCount} | ${tokensOf(sample.systemPrompt)} | ${tokensOf(sample.toolSchemas)} | ${tokensOf(sample.userTurns)} | ${tokensOf(sample.assistantText)} | ${tokensOf(sample.toolCallArgs)} | ${tokensOf(sample.toolResults)} | ${sample.estimatedInputTokens} | ${sample.reportedInputTokens} | ${sample.cachedInputTokens} |`;
	});
	return [header, ...rows].join('\n');
}

/** Coefficient of determination between two columns. The one statistic this report needs:
 * issue #271 claims a document's bill tracks its step count rather than its content, and
 * two R2 values side by side either support that or do not. */
function rSquared(xs: number[], ys: number[]): number {
	const n = xs.length;
	// Three points is already thin; two make R2 exactly 1 by construction, which would read
	// as a result rather than as an artefact of running one source.
	if (n < 4) return Number.NaN;
	const mx = xs.reduce((a, b) => a + b, 0) / n;
	const my = ys.reduce((a, b) => a + b, 0) / n;
	let cov = 0;
	let vx = 0;
	let vy = 0;
	for (let i = 0; i < n; i++) {
		cov += (xs[i]! - mx) * (ys[i]! - my);
		vx += (xs[i]! - mx) ** 2;
		vy += (ys[i]! - my) ** 2;
	}
	if (vx === 0 || vy === 0) return 0;
	return (cov / Math.sqrt(vx * vy)) ** 2;
}

function renderReport(report: LoopCostReport): string {
	const lines: string[] = [
		`# Loop cost, issue #271`,
		'',
		`Ran ${report.ranAt} against \`${report.cheapModel}\` (cheap) and \`${report.premiumModel}\` (premium), corpus revision ${report.revision}.`,
		'',
		'Token columns are characters divided by four, this repo\u2019s convention; the last column is what the provider itself reported for the same call.',
		'',
		'## Per document',
		'',
		'| source | document | size | content chars | steps | step budget | status | input tokens | output tokens | credits | credits per 1k content chars |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
	];

	for (const run of report.runs) {
		const perKilo =
			run.contentChars > 0 ? ((run.credits / run.contentChars) * 1000).toFixed(4) : 'n/a';
		lines.push(
			`| ${run.source} | \`${run.sourcePath}\` | ${run.size} | ${run.contentChars < 0 ? 'n/a' : run.contentChars} | ${run.steps} | ${run.stepBudget} | ${run.status} | ${run.inputTokens} | ${run.outputTokens} | ${run.credits.toFixed(4)} | ${perKilo} |`
		);
	}

	lines.push('', '## Fixed against accumulated, per document', '');
	lines.push(
		'| source | document | model calls | fixed tokens per step | accumulated, first step | accumulated, last step | tool results as share of last step | fixed share, estimated | fixed share, provider-counted | chars/4 drift over reported |'
	);
	lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const run of report.runs) {
		const parts = split(run.samples);
		lines.push(
			`| ${run.source} | \`${run.sourcePath}\` | ${run.samples.length} | ${parts.fixedTokens} | ${parts.accumulatedFirst} | ${parts.accumulatedLast} | ${(parts.toolResultShareLast * 100).toFixed(1)}% | ${(parts.fixedShare * 100).toFixed(1)}% | ${(parts.reportedFixedShare * 100).toFixed(1)}% | ${(parts.estimateDrift * 100).toFixed(1)}% |`
		);
	}

	const credits = report.runs.map((run) => run.credits);
	const calls = report.runs.map((run) => run.samples.length);
	const chars = report.runs.map((run) => run.contentChars);
	const perCall = report.runs
		.filter((run) => run.samples.length > 0)
		.map((run) => run.credits / run.samples.length);
	const perKilo = report.runs
		.filter((run) => run.contentChars > 0)
		.map((run) => (run.credits / run.contentChars) * 1000);
	const r2 = (xs: number[]) => {
		const value = rSquared(xs, credits);
		return Number.isNaN(value) ? 'too few runs' : value.toFixed(3);
	};
	lines.push('', '## What predicts a document\u2019s bill', '');
	lines.push(`${report.runs.length} document runs.`, '');
	lines.push('| relation | R2 |', '| --- | --- |');
	lines.push(`| credits against model calls | ${r2(calls)} |`);
	lines.push(`| credits against content characters | ${r2(chars)} |`);
	lines.push('');
	lines.push(
		`Credits per model call range ${Math.min(...perCall).toFixed(4)} to ${Math.max(...perCall).toFixed(4)}, a spread of ${(Math.max(...perCall) / Math.min(...perCall)).toFixed(1)}x. ` +
			`Credits per 1000 content characters range ${Math.min(...perKilo).toFixed(4)} to ${Math.max(...perKilo).toFixed(4)}, a spread of ${(Math.max(...perKilo) / Math.min(...perKilo)).toFixed(1)}x.`
	);

	const allReported = report.runs.reduce(
		(sum, run) => sum + run.samples.reduce((a, b) => a + b.reportedInputTokens, 0),
		0
	);
	const allFixed = report.runs.reduce(
		(sum, run) => sum + (run.samples[0]?.reportedInputTokens ?? 0) * run.samples.length,
		0
	);
	const allCached = report.runs.reduce(
		(sum, run) => sum + run.samples.reduce((a, b) => a + b.cachedInputTokens, 0),
		0
	);
	const hits = report.runs.flatMap((run) => run.samples).filter((s) => s.cachedInputTokens > 0);
	const allCalls = report.runs.reduce((sum, run) => sum + run.samples.length, 0);
	lines.push('');
	lines.push(
		`Over the whole run: ${allReported} reported input tokens across ${allCalls} model calls, of which ` +
			`${allFixed} (${((allFixed / Math.max(allReported, 1)) * 100).toFixed(1)}%) are the fixed block re-sent, which no transcript strategy can touch: perfect pruning tops out at the remaining ` +
			`${(100 - (allFixed / Math.max(allReported, 1)) * 100).toFixed(1)}%. ` +
			`${allCached} (${((allCached / Math.max(allReported, 1)) * 100).toFixed(1)}%) were served from the provider's own prompt cache, on ${hits.length} of ${allCalls} calls, and \`computeCost\` prices none of them as cached.`
	);

	lines.push('', '## The fixed block, per playbook', '');
	lines.push(
		'| playbook | system prompt tokens | tool schema tokens | opening ask | fixed tokens per step | step budget | fixed tokens if a document spends its whole budget |'
	);
	lines.push('| --- | --- | --- | --- | --- | --- | --- |');
	const seen = new Set<string>();
	for (const run of report.runs) {
		const first = run.samples[0];
		if (!first || seen.has(run.playbookId)) continue;
		seen.add(run.playbookId);
		const fixed = tokensOf(first.systemPrompt + first.toolSchemas + first.userTurns);
		lines.push(
			`| ${run.playbookId} | ${tokensOf(first.systemPrompt)} | ${tokensOf(first.toolSchemas)} | ${tokensOf(first.userTurns)} | ${fixed} | ${run.stepBudget} | ${fixed * run.stepBudget} |`
		);
	}

	for (const run of report.runs) {
		if (run.samples.length === 0) continue;
		lines.push(
			'',
			`## Per step: ${run.source} \`${run.sourcePath}\``,
			'',
			renderStepTable(run.samples)
		);
	}

	return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	const only = process.argv.slice(2).reduce<string[]>((acc, value, index, all) => {
		if (value === '--source' && all[index + 1]) acc.push(all[index + 1]!);
		return acc;
	}, []);
	const revision = (arg('revision') ?? 'v1') as 'v1' | 'v2';
	const which = arg('documents') ?? 'extremes';

	const db = createDb(url, { max: 4, quiet: true });
	const report: LoopCostReport = {
		ranAt: new Date().toISOString(),
		cheapModel: '',
		premiumModel: '',
		revision,
		runs: []
	};

	try {
		await benchFixture(db);
		await topUpCredits(db);
		const cheap = await resolveModel(db, 'cheap');
		const premium = await resolveModel(db, 'premium');
		report.cheapModel = `${cheap.provider}/${cheap.modelId}`;
		report.premiumModel = `${premium.provider}/${premium.modelId}`;

		for (const source of only.length > 0 ? only : ALL_SOURCES) {
			const manifest = JSON.parse(
				readFileSync(manifestPath(source, revision), 'utf8')
			) as CorpusManifest;
			const playbook = await loadBuiltinPlaybook(manifest.playbook);

			for (const picked of await documentsFor(source, revision, which)) {
				// One job per document, so nothing about one document's transcript can reach
				// another's and the per-document numbers stay per-document.
				const jobId = `loop-cost-${source}-${picked.document.id}-${Date.now()}`;
				const run = await runImportDocuments({
					db,
					archive: archivePath(source, revision),
					playbookId: manifest.playbook,
					documents: [picked.document],
					jobId,
					maxCredits: CREDITS_PER_DOCUMENT,
					profile: true
				});

				const record: DocumentRun = {
					source,
					playbookId: manifest.playbook,
					stepBudget: playbook.stepBudget,
					sourcePath: picked.document.sourcePath,
					contentChars: picked.contentChars,
					size: picked.size,
					status: run.status,
					detail: run.detail,
					steps: run.steps,
					entities: run.entities.length,
					relations: run.relations.length,
					inputTokens: run.inputTokens,
					outputTokens: run.outputTokens,
					credits: run.credits,
					costEur: run.costEur,
					samples: run.stepProfile
				};
				report.runs.push(record);
				console.log(
					`${source.padEnd(12)} ${picked.document.sourcePath.padEnd(52)} ` +
						`${String(picked.contentChars).padStart(6)} chars  ` +
						`${String(record.steps).padStart(2)}/${record.stepBudget} steps  ` +
						`${String(record.inputTokens).padStart(7)} in  ` +
						`${record.credits.toFixed(4)} credits  ${record.status}`
				);
			}
		}
	} finally {
		await db.$client.end({ timeout: 5 });
	}

	mkdirSync(dataDir, { recursive: true });
	writeFileSync(path.join(dataDir, 'loop-cost.json'), JSON.stringify(report, null, '\t'));
	writeFileSync(path.join(dataDir, 'loop-cost.md'), renderReport(report));
	console.log(`\nwrote ${path.join(dataDir, 'loop-cost.json')} and loop-cost.md`);
}

await main();
