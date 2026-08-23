/**
 * The bench's entry point.
 *
 *   pnpm --filter @canonry/bench models -- --preflight
 *   pnpm --filter @canonry/bench models -- --purpose cheap
 *   pnpm --filter @canonry/bench models -- --purpose premium --only anthropic/claude-opus-4.8
 *
 * Needs `AI_GATEWAY_API_KEY` and a `DATABASE_URL` pointed at a scratch database, because
 * a run writes `model_config`, `proposal`, `revision` and `model_call` rows for real. It
 * refuses a database whose name does not end in `_bench` or `_e2e` for exactly that
 * reason: the point of running the product's own code is that it has the product's own
 * effects.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, createDb } from '@canonry/db';
import { dataDir, loadEnv, requireEnv } from '../env.js';
import { CANDIDATES, type BenchPurpose } from './candidates.js';
import { loadCatalogue } from './catalogue.js';
import { assertCreditAvailable, GatewayOutOfCreditError } from './credits.js';
import { allBenchSlugs, preflight } from './preflight.js';
import { runCandidate, type BenchTask, type CandidateResult } from './runner.js';
import { renderReport } from './report.js';
import { tasksFor } from './tasks/index.js';

interface Args {
	preflight: boolean;
	purposes: BenchPurpose[];
	only: string[];
	tasks: string[];
	cases: string[];
	refreshCatalogue: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		preflight: false,
		purposes: [],
		only: [],
		tasks: [],
		cases: [],
		refreshCatalogue: false
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === undefined || flag === '--') continue;
		if (flag === '--preflight') args.preflight = true;
		else if (flag === '--refresh-catalogue') args.refreshCatalogue = true;
		else if (flag === '--purpose') args.purposes.push(argv[++i] as BenchPurpose);
		else if (flag === '--only') args.only.push(argv[++i]!);
		else if (flag === '--task') args.tasks.push(argv[++i]!);
		else if (flag === '--case') args.cases.push(argv[++i]!);
		else throw new Error(`unknown flag ${flag}`);
	}
	if (args.purposes.length === 0 && !args.preflight) {
		args.purposes = ['cheap', 'premium', 'multimodal'];
	}
	return args;
}

function assertScratchDatabase(url: string): void {
	const name = new URL(url).pathname.replace(/^\//, '');
	if (!/(_bench|_e2e)$/.test(name)) {
		throw new Error(
			`refusing to run the bench against database "${name}". It writes real proposals, ` +
				'revisions and model_config rows. Point DATABASE_URL at a database whose name ends ' +
				'in _bench or _e2e.'
		);
	}
}

async function main(): Promise<void> {
	loadEnv();
	const args = parseArgs(process.argv.slice(2));
	const catalogue = await loadCatalogue({ refresh: args.refreshCatalogue });
	mkdirSync(dataDir, { recursive: true });

	if (args.preflight) {
		const rows = await preflight(allBenchSlugs());
		writeFileSync(path.join(dataDir, 'preflight.json'), JSON.stringify(rows, null, '\t'));
		const width = Math.max(...rows.map((r) => r.slug.length));
		console.log(
			`${'model'.padEnd(width)}  reach  object  tool  vision   ms  note`.replace(/\s+$/, '')
		);
		for (const row of rows) {
			const mark = (value: boolean | null) =>
				value === null ? ' -   ' : value ? ' yes ' : ' NO  ';
			console.log(
				`${row.slug.padEnd(width)} ${mark(row.reachable)} ${mark(row.structuredOutput)} ${mark(
					row.toolCall
				)} ${mark(row.vision)} ${String(row.latencyMs).padStart(5)}  ${row.note}`.trimEnd()
			);
		}
		const broken = rows.filter((r) => !r.reachable || !r.structuredOutput);
		console.log(`\n${rows.length} slugs, ${broken.length} unusable`);
		return;
	}

	const url = requireEnv('DATABASE_URL');
	assertScratchDatabase(url);
	const db = createDb(url, { max: 4, quiet: true });
	const results: CandidateResult[] = [];

	try {
		for (const purpose of args.purposes) {
			const all = tasksFor(purpose);
			const tasks: BenchTask[] =
				args.tasks.length === 0 ? all : all.filter((t) => args.tasks.includes(t.id));
			if (args.cases.length > 0) {
				// A typo in a case id would otherwise run zero cases and report a candidate with
				// no tasks, which reads like a model that answered nothing.
				const known = new Set((await Promise.all(tasks.map((t) => t.caseIds()))).flat());
				const unknown = args.cases.filter((id) => !known.has(id));
				if (unknown.length > 0) {
					throw new Error(
						`no such case for purpose ${purpose}: ${unknown.join(', ')}. Known: ${[...known].join(', ')}`
					);
				}
			}
			const candidates = CANDIDATES[purpose].filter(
				(c) => args.only.length === 0 || args.only.includes(c.slug)
			);
			for (const candidate of candidates) {
				if (candidate.disqualified !== undefined && args.only.length === 0) {
					process.stdout.write(
						`\n${purpose}  ${candidate.slug}\n  skipped: ${candidate.disqualified}\n`
					);
					continue;
				}
				const balance = await assertCreditAvailable();
				process.stdout.write(
					`\n${purpose}  ${candidate.slug}  (gateway balance ${balance.balanceUsd.toFixed(2)} USD)\n`
				);
				const result = await runCandidate({
					db,
					catalogue,
					purpose,
					candidate,
					tasks,
					cases: args.cases,
					onCase: (taskId, outcome) => {
						const mark = outcome.ok ? outcome.score.toFixed(2) : 'FAIL';
						process.stdout.write(`  ${taskId.padEnd(10)} ${outcome.caseId.padEnd(34)} ${mark}\n`);
					}
				});
				results.push(result);
				writeFileSync(
					path.join(dataDir, `models-${args.purposes.join('-')}.json`),
					JSON.stringify(results, null, '\t')
				);
			}
		}
	} catch (error) {
		if (!(error instanceof GatewayOutOfCreditError)) throw error;
		// Not a failure of the run: everything already measured stays valid and is reported
		// below, and the candidates that never started are simply absent rather than present
		// with a fabricated zero.
		console.error(`\n${error.message}\n`);
	} finally {
		await closeDb(db);
	}

	const report = renderReport(results, catalogue);
	const reportPath = path.join(dataDir, `models-${args.purposes.join('-')}.md`);
	writeFileSync(reportPath, report);
	console.log(`\n${report}\n\nwritten to ${reportPath}`);
}

await main();
