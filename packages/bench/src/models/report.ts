/**
 * Turning a run into the table the decision gets taken from.
 *
 * The one design choice worth defending: there is no single "winner" column. A weighted
 * total across three tasks with different units is a number nobody can check, and it hides
 * the case that actually decides things, which is a model that is excellent at two tasks
 * and dangerous at the third. So the report prints per-task scores, the cost of the whole
 * purpose at a realistic monthly volume, and the failure rate, and leaves the reader to
 * take the decision the evidence supports. The decision itself is written down in prose,
 * in `docs/models.md`, next to the numbers that produced it.
 *
 * Volumes come from SPEC.md §5.1's own worked example (a propagation plan is one cheap
 * call plus up to ten premium ones) and from what a GM who imports a world and then works
 * on it for a month actually triggers. They are stated here rather than buried so that
 * disagreeing with the cost column means disagreeing with a number you can see.
 */
import { pricesFor, type Catalogue } from './catalogue.js';
import type { BenchPurpose } from './candidates.js';
import type { CandidateResult, TaskResult } from './runner.js';

/**
 * One "active month" of a single GM, as SPEC.md §5.1 and §6 describe the product being
 * used: an import of a few hundred documents, then eighty saves, each of which plans a
 * propagation and audits the sub-graph it touched, with roughly a third of the plans taken
 * through to diffs, plus forty Ask questions and a dozen thin entries completed.
 */
export const MONTHLY_VOLUME: Record<
	BenchPurpose,
	{ operation: string; calls: number; taskId: string }[]
> = {
	cheap: [
		{ operation: 'import extraction, one call per document', calls: 214, taskId: 'extract' },
		{ operation: 'propagate.plan, one per save', calls: 80, taskId: 'rank' },
		{ operation: 'audit.flag, up to five pairs per save', calls: 240, taskId: 'audit' }
	],
	premium: [
		{ operation: 'propagate.diff, ~7 entries on a third of plans', calls: 190, taskId: 'diff' },
		{ operation: 'ask.answer', calls: 40, taskId: 'ask' },
		{ operation: 'entry.complete', calls: 12, taskId: 'complete' }
	],
	multimodal: [{ operation: 'page_image, scanned pages in an import', calls: 20, taskId: 'page' }]
};

/**
 * The aggregate the decision is actually taken on.
 *
 * A plain mean over three tasks treats one Ask answer as worth the same as one propagation
 * diff, and the product does not: on the volumes above, `diff` is 190 of the premium
 * purpose's 242 monthly calls and `complete` is twelve. Weighting by those volumes changes
 * the premium ranking materially rather than cosmetically, which is the whole reason to
 * print both columns and say which one the choice rests on.
 */
export function weightedScore(purpose: BenchPurpose, tasks: TaskResult[]): number {
	const weights = MONTHLY_VOLUME[purpose];
	let numerator = 0;
	let denominator = 0;
	for (const task of tasks) {
		const weight = weights.find((w) => w.taskId === task.taskId)?.calls ?? 0;
		numerator += weight * task.meanScore;
		denominator += weight;
	}
	return denominator === 0 ? 0 : numerator / denominator;
}

function tableRow(cells: string[]): string {
	return `| ${cells.join(' | ')} |`;
}

function fmt(value: number, digits = 3): string {
	return value.toFixed(digits);
}

/** Mean tokens per call across every task a candidate ran, which is what turns a price per
 * million into a price per month. Measured, never assumed: a reasoning model that emits
 * two thousand thinking tokens per call costs what it costs. */
function perCallTokens(tasks: TaskResult[]): { input: number; output: number } {
	let calls = 0;
	let input = 0;
	let output = 0;
	for (const task of tasks) {
		calls += task.cases.length;
		input += task.totalInputTokens;
		output += task.totalOutputTokens;
	}
	if (calls === 0) return { input: 0, output: 0 };
	return { input: input / calls, output: output / calls };
}

export function monthlyCostEur(
	catalogue: Catalogue,
	slug: string,
	purpose: BenchPurpose,
	tasks: TaskResult[]
): number {
	const prices = pricesFor(catalogue, slug);
	const per = perCallTokens(tasks);
	const calls = MONTHLY_VOLUME[purpose].reduce((a, v) => a + v.calls, 0);
	return (
		(per.input * calls * prices.eurPerInputMTok) / 1e6 +
		(per.output * calls * prices.eurPerOutputMTok) / 1e6
	);
}

export function renderReport(results: CandidateResult[], catalogue: Catalogue): string {
	const out: string[] = [];
	const purposes = [...new Set(results.map((r) => r.purpose))];

	for (const purpose of purposes) {
		const forPurpose = results.filter((r) => r.purpose === purpose);
		const taskIds = [...new Set(forPurpose.flatMap((r) => r.tasks.map((t) => t.taskId)))];

		out.push(`## ${purpose}`);
		out.push('');
		const volume = MONTHLY_VOLUME[purpose];
		out.push(
			'Ranked by the weighted column, which weights each task by the calls it carries in a ' +
				'month rather than treating them as equal.'
		);
		out.push('');
		out.push(
			`Monthly volume assumed for the cost and weighted columns: ${volume
				.map((v) => `${v.calls} ${v.operation}`)
				.join('; ')}. Total ${volume.reduce((a, v) => a + v.calls, 0)} calls.`
		);
		out.push('');

		const header = [
			'model',
			...taskIds,
			'mean',
			'weighted',
			'fail %',
			'median ms',
			'in tok/call',
			'out tok/call',
			'EUR / month'
		];
		out.push(tableRow(header));
		out.push(tableRow(header.map(() => '---')));

		const rows = forPurpose
			.map((result) => {
				const scores = taskIds.map(
					(id) => result.tasks.find((t) => t.taskId === id)?.meanScore ?? Number.NaN
				);
				const present = scores.filter((s) => !Number.isNaN(s));
				const mean = present.length === 0 ? 0 : present.reduce((a, b) => a + b, 0) / present.length;
				const failures =
					result.tasks.reduce((a, t) => a + t.failureRate * t.cases.length, 0) /
					Math.max(
						1,
						result.tasks.reduce((a, t) => a + t.cases.length, 0)
					);
				const latency =
					result.tasks.length === 0
						? 0
						: result.tasks.reduce((a, t) => a + t.medianLatencyMs, 0) / result.tasks.length;
				const per = perCallTokens(result.tasks);
				return {
					result,
					mean: weightedScore(purpose, result.tasks),
					cells: [
						`${result.slug}${result.incumbent ? ' **(now)**' : ''}${
							result.outsideKnownProviders ? ' †' : ''
						}`,
						...scores.map((s) => (Number.isNaN(s) ? '-' : fmt(s))),
						fmt(mean),
						fmt(weightedScore(purpose, result.tasks)),
						(failures * 100).toFixed(0),
						latency.toFixed(0),
						per.input.toFixed(0),
						per.output.toFixed(0),
						monthlyCostEur(catalogue, result.slug, purpose, result.tasks).toFixed(2)
					]
				};
			})
			.sort((a, b) => b.mean - a.mean);

		for (const row of rows) out.push(tableRow(row.cells));
		out.push('');
		if (rows.some((r) => r.result.outsideKnownProviders)) {
			out.push(
				'† provider not in `KNOWN_PROVIDERS` (`packages/ai/src/composition.ts`). Adopting one means adding it there, with this measurement as the reason.'
			);
			out.push('');
		}

		for (const taskId of taskIds) {
			const sample = forPurpose[0]?.tasks.find((t) => t.taskId === taskId);
			if (sample) out.push(`- \`${taskId}\`: ${describeTask(taskId)}`);
		}
		out.push('');
	}

	return out.join('\n');
}

const TASK_DESCRIPTIONS: Record<string, string> = {
	rank: 'of the deterministic shortlist, keeps what a GM wants and drops the noise, and writes the plan in the reader locale',
	audit:
		'judges whether two statements from different entries disagree, against twenty labelled pairs, half of them deliberately compatible',
	extract:
		'runs the real import loop over one document and scores the entities and relations it proposed against the corpus gold',
	diff: 'writes the propagated update to one entry, judged for grounding, usefulness and craft',
	complete: 'drafts the missing content of a thin entry, judged the same way',
	ask: 'answers a question from retrieved canon, judged, with a hard zero for a claim the sources do not carry',
	page: 'reads a scanned page with no text layer, scored on character accuracy against the page we printed and on the entities it found'
};

function describeTask(taskId: string): string {
	return TASK_DESCRIPTIONS[taskId] ?? 'no description recorded';
}
