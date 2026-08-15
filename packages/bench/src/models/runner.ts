/**
 * The loop: for each candidate, point `model_config` at it, run every case of every task
 * for its purpose, and record what came back, what it cost and how long it took.
 *
 * Three things this deliberately does not do:
 *
 * - **It does not retry a bad answer.** A transient 429 or 5xx is retried, because that
 *   measures the gateway and not the model. A model that returns a schema violation or an
 *   empty answer has failed the case, and papering over that with a second attempt is how
 *   a benchmark ends up preferring the model with the worst first-try reliability.
 * - **It does not run cases concurrently within one candidate.** Latency is one of the
 *   numbers, and a provider under self-inflicted parallel load reports a latency about the
 *   bench rather than about the model. Candidates run one after another for the same
 *   reason.
 * - **It does not invent a cost.** Tokens come from what the call actually reported, and
 *   euros from the gateway's own price list through `model_config.params`, which is the
 *   same path `model_call.cost_eur` takes in production.
 */
import { and, eq, type Db } from '@canonry/db';
import { gte } from 'drizzle-orm';
import { modelCall } from '@canonry/db/schema';
import type { ModelPurpose } from '@canonry/db/schema';
import type { Catalogue } from './catalogue.js';
import { setActiveModel } from './factory.js';
import type { BenchPurpose, Candidate } from './candidates.js';

export interface CaseOutcome {
	caseId: string;
	/** False when the call itself failed: a refusal, a schema violation, a timeout. A
	 * failed case scores zero, and the failure rate is reported next to the score because
	 * the two say different things about a model. */
	ok: boolean;
	error?: string;
	/** 0 to 1. Objective where the task has a gold answer, judged where it does not. */
	score: number;
	/** Everything worth reading when a number looks wrong: what the model said, which
	 * slugs it picked, which sentence it quoted. Written to disk, not to the table. */
	detail: Record<string, unknown>;
	latencyMs: number;
	inputTokens: number;
	outputTokens: number;
	costEur: number;
}

export interface TaskContext {
	db: Db;
	/** The slug under test, for a task that needs to name it in a log line. */
	slug: string;
	purpose: BenchPurpose;
}

export interface BenchTask {
	id: string;
	purpose: BenchPurpose;
	/** One line naming exactly what this task scores, printed above its table. */
	measures: string;
	/** Case ids, in a fixed order, so two runs are comparable line by line. */
	caseIds(): Promise<string[]> | string[];
	runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome>;
}

export interface TaskResult {
	taskId: string;
	slug: string;
	cases: CaseOutcome[];
	meanScore: number;
	failureRate: number;
	medianLatencyMs: number;
	totalCostEur: number;
	totalInputTokens: number;
	totalOutputTokens: number;
}

export interface CandidateResult {
	slug: string;
	purpose: BenchPurpose;
	outsideKnownProviders: boolean;
	incumbent: boolean;
	tasks: TaskResult[];
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function summarise(taskId: string, slug: string, cases: CaseOutcome[]): TaskResult {
	const failures = cases.filter((c) => !c.ok).length;
	return {
		taskId,
		slug,
		cases,
		meanScore: cases.length === 0 ? 0 : cases.reduce((a, c) => a + c.score, 0) / cases.length,
		failureRate: cases.length === 0 ? 0 : failures / cases.length,
		medianLatencyMs: median(cases.map((c) => c.latencyMs)),
		totalCostEur: cases.reduce((a, c) => a + c.costEur, 0),
		totalInputTokens: cases.reduce((a, c) => a + c.inputTokens, 0),
		totalOutputTokens: cases.reduce((a, c) => a + c.outputTokens, 0)
	};
}

export interface UsageWindow {
	inputTokens: number;
	outputTokens: number;
	costEur: number;
	calls: number;
}

/**
 * What the product recorded for itself while one case ran. Reads `model_call`, which is
 * the row SPEC.md §11.5 requires every call to leave behind, so a task whose usage window
 * comes back empty is telling you the accounting is missing, not that the call was free.
 * `packages/import` is the known case: issue #133 says an import writes no `model_call`
 * rows at all, so the import task reads the driver's own `usage` events instead and says so.
 */
export async function usageSince(
	db: Db,
	since: Date,
	provider: string,
	modelId: string
): Promise<UsageWindow> {
	const rows = await db
		.select({
			inputTokens: modelCall.inputTokens,
			outputTokens: modelCall.outputTokens,
			costEur: modelCall.costEur
		})
		.from(modelCall)
		.where(
			and(
				gte(modelCall.createdAt, since),
				eq(modelCall.provider, provider),
				eq(modelCall.modelId, modelId)
			)
		);
	let inputTokens = 0;
	let outputTokens = 0;
	let costEur = 0;
	for (const row of rows) {
		inputTokens += row.inputTokens ?? 0;
		outputTokens += row.outputTokens ?? 0;
		costEur += Number(row.costEur ?? 0);
	}
	return { inputTokens, outputTokens, costEur, calls: rows.length };
}

/** Retries only what is worth retrying: the gateway saying "later". Anything else is the
 * model's answer and the case keeps it. */
export function isTransient(error: unknown): boolean {
	const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	return /\b(429|500|502|503|504|overloaded|rate.?limit|timeout|ETIMEDOUT|ECONNRESET)\b/i.test(
		text
	);
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
	let last: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			last = error;
			if (!isTransient(error) || attempt === attempts) throw error;
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 1500 * attempt * attempt);
			await promise;
		}
	}
	throw last;
}

export interface RunCandidateOptions {
	db: Db;
	catalogue: Catalogue;
	purpose: BenchPurpose;
	candidate: Candidate;
	tasks: BenchTask[];
	onCase?: (taskId: string, outcome: CaseOutcome) => void;
}

export async function runCandidate(options: RunCandidateOptions): Promise<CandidateResult> {
	const { db, catalogue, purpose, candidate, tasks } = options;
	await setActiveModel(db, purpose as ModelPurpose, candidate.slug, catalogue);

	const results: TaskResult[] = [];
	for (const task of tasks) {
		const ids = await task.caseIds();
		const cases: CaseOutcome[] = [];
		for (const caseId of ids) {
			const started = Date.now();
			let outcome: CaseOutcome;
			try {
				outcome = await task.runCase({ db, slug: candidate.slug, purpose }, caseId);
			} catch (error) {
				outcome = {
					caseId,
					ok: false,
					error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
					score: 0,
					detail: {},
					latencyMs: Date.now() - started,
					inputTokens: 0,
					outputTokens: 0,
					costEur: 0
				};
			}
			cases.push(outcome);
			options.onCase?.(task.id, outcome);
		}
		results.push(summarise(task.id, candidate.slug, cases));
	}

	return {
		slug: candidate.slug,
		purpose,
		outsideKnownProviders: candidate.outsideKnownProviders ?? false,
		incumbent: candidate.incumbent ?? false,
		tasks: results
	};
}
