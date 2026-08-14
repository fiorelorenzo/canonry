/**
 * SPEC.md §5.1/§5.2: propagation and audit run "on save, debounced, in the background."
 * This is the ignition the rest of `packages/copilot` never got wired to: every route
 * that writes a human-authored `revision` calls `scheduleCanonSaveJob` after its own
 * transaction commits, and this file is what actually runs `planPropagation` and
 * `runAudit` against that save, off the request/response cycle, through the debounce and
 * concurrency machinery in `queue.ts`.
 *
 * Two engines, two independent outcomes per job - a failure in one never blocks the
 * other, and both check guardrail 4 and spend independently before either runs
 * (`requireAiEnabled` is the first line of both `planPropagation` and `runAudit` in
 * `@canonry/copilot`, so "no spend while AI is off" holds without this file re-checking
 * it - re-checking it here would just be a second place for that rule to drift from the
 * first).
 *
 * What this file deliberately does NOT call: `generatePlanDiffs`. Decision C3
 * (`docs/ux/DECISIONS.md`) is "flat checklist, entries droppable before any diff is
 * written", and `docs/ux/c3-propagation-plan.html`'s own "Rejected outright" section names
 * the alternative by hand: "generate every diff first, let the GM delete what they do not
 * want after ... burns the premium model's writes on entries nobody asked to see." The
 * plan detail route (`u/[universe]/proposals/[plan]/+page.server.ts`'s `generateDiffs`
 * action) is already the one explicit, priced, human-triggered step that turns a plan's
 * checklist into diffs. This job produces exactly the readable, droppable checklist
 * SPEC.md §5.1 step 3 describes - `planPropagation` alone - and stops there, on purpose,
 * so that already-built step still means something: reusing it here instead of also
 * calling `generatePlanDiffs` is what keeps this a single diff-generation path rather than
 * a second one running behind the GM's back.
 *
 * Recursion guard: the only callers of `scheduleCanonSaveJob` are routes that write a
 * `revision` with `author_kind: 'human'`. An accepted AI proposal writes its own revision
 * with `author_kind: 'ai_accepted'` through `acceptProposal` (`@canonry/db`) - a function
 * this file never calls, on a route (`proposals/[plan]/+page.server.ts`'s `accept` action)
 * that never imports this module. So an accept can never re-trigger propagation on itself;
 * that is a structural guarantee (the accept code path and this file share no call edge),
 * not a runtime flag two files have to keep in sync.
 */
import { AiDisabledError, planPropagation, runAudit } from '@canonry/copilot';
import type { GatewayWrapper, ModelFactory } from '@canonry/copilot';
import type { Db } from '@canonry/db';
import { DebouncedJobQueue, type JobQueueOptions } from './queue.js';

export interface CanonSaveJobInput {
	db: Db;
	universeId: string;
	entityId: string;
	entityName: string;
	userId: string;
	oldBody: string;
	newBody: string;
	triggerRevisionId: string | null;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
}

export type EngineOutcome =
	| { status: 'ok'; planId: string }
	| { status: 'no-change' }
	| { status: 'ai-disabled' }
	| { status: 'error'; errorName: string; message: string };

export interface CanonSaveJobResult {
	universeId: string;
	entityId: string;
	entityName: string;
	startedAt: Date;
	finishedAt: Date;
	propagation: EngineOutcome;
	audit: EngineOutcome;
}

/** Every failure that happens *inside* an actual model call already logs through
 * `@canonry/ai`'s own logger, from inside `withQuota` - every call `planPropagation` and
 * `runAudit` make goes through it (ranking.ts, diffs.ts, audit.ts). That logger is not
 * part of `@canonry/ai`'s public surface (by design: it whitelists exactly the metadata
 * fields SPEC 6.5 allows a log line to carry), so this file cannot call it directly, and
 * does not need to - it already fired before this ever sees the error. What this function
 * covers is the other half: a failure with nobody upstream logging it at all (the
 * candidate graph failing to load, a `resolveModel` miss before any model call happens),
 * plus turning *every* failure into a job-level record a human can actually find, since a
 * console line from deep inside `@canonry/ai` says nothing about which entity's save
 * produced it. */
function describeEngineFailure(
	err: unknown,
	universeId: string,
	entityId: string,
	engine: 'propagate.plan' | 'audit.flag'
): EngineOutcome {
	if (err instanceof AiDisabledError) return { status: 'ai-disabled' };
	const errorName = err instanceof Error ? err.name : 'UnknownError';
	const message = err instanceof Error ? err.message : String(err);
	console.error(
		JSON.stringify({
			event: 'canon_save_job_failed',
			engine,
			universeId,
			entityId,
			errorName,
			message
		})
	);
	return { status: 'error', errorName, message };
}

async function runPropagationEngine(input: CanonSaveJobInput): Promise<EngineOutcome> {
	try {
		const result = await planPropagation({
			db: input.db,
			userId: input.userId,
			universeId: input.universeId,
			editedEntityId: input.entityId,
			editedEntityName: input.entityName,
			oldBody: input.oldBody,
			newBody: input.newBody,
			triggerRevisionId: input.triggerRevisionId,
			modelFactory: input.modelFactory,
			gateway: input.gateway
		});
		return result ? { status: 'ok', planId: result.plan.id } : { status: 'no-change' };
	} catch (err) {
		return describeEngineFailure(err, input.universeId, input.entityId, 'propagate.plan');
	}
}

async function runAuditEngine(input: CanonSaveJobInput): Promise<EngineOutcome> {
	try {
		const result = await runAudit({
			db: input.db,
			userId: input.userId,
			universeId: input.universeId,
			editedEntityId: input.entityId,
			oldBody: input.oldBody,
			newBody: input.newBody,
			modelFactory: input.modelFactory,
			gateway: input.gateway
		});
		return result.plan ? { status: 'ok', planId: result.plan.id } : { status: 'no-change' };
	} catch (err) {
		return describeEngineFailure(err, input.universeId, input.entityId, 'audit.flag');
	}
}

/** A burst still inside its debounce window (or a save landing while a run is in flight)
 * keeps the earliest `oldBody` and always advances to the newest `newBody` - five saves in
 * a row diff "before the first" against "after the last", one run, not five. Everything
 * else (actor, entity name, the revision to attribute the plan to) takes the latest save's
 * value, since that is genuinely what is true by the time the job runs. */
function mergeCanonSaveInput(
	accumulated: CanonSaveJobInput,
	next: CanonSaveJobInput
): CanonSaveJobInput {
	return { ...next, oldBody: accumulated.oldBody };
}

/** Once a run starts, its own `newBody` becomes the baseline for anything that arrives
 * while it is executing, so a follow-up run diffs "since this run" rather than re-covering
 * territory the running job already accounted for. */
function settleCanonSaveInput(ranInput: CanonSaveJobInput): CanonSaveJobInput {
	return { ...ranInput, oldBody: ranInput.newBody };
}

const RECENT_JOBS_LIMIT = 200;

/** One `DebouncedJobQueue` instance's whole public surface: schedule a save, and (test-
 * only) find out what it did. Exists as a factory rather than a single module-level
 * singleton so tests can build an isolated queue with a short debounce instead of sharing
 * timing with (or polluting the history of) the production one. */
export interface CanonSaveJobQueue {
	schedule(input: CanonSaveJobInput): void;
	waitForIdle(timeoutMs?: number): Promise<void>;
	recentJobs(limit?: number): CanonSaveJobResult[];
}

export function createCanonSaveJobQueue(options: JobQueueOptions): CanonSaveJobQueue {
	const recent: CanonSaveJobResult[] = [];
	const queue = new DebouncedJobQueue<CanonSaveJobInput>(options, {
		merge: mergeCanonSaveInput,
		settle: settleCanonSaveInput,
		async execute(input) {
			const startedAt = new Date();
			const [propagation, audit] = await Promise.all([
				runPropagationEngine(input),
				runAuditEngine(input)
			]);
			recent.push({
				universeId: input.universeId,
				entityId: input.entityId,
				entityName: input.entityName,
				startedAt,
				finishedAt: new Date(),
				propagation,
				audit
			});
			if (recent.length > RECENT_JOBS_LIMIT) recent.shift();
		}
	});
	return {
		schedule: (input) => queue.schedule(`${input.universeId}:${input.entityId}`, input),
		waitForIdle: (timeoutMs) => queue.waitForIdle(timeoutMs),
		recentJobs: (limit) => (limit === undefined ? recent.slice() : recent.slice(-limit))
	};
}

// SPEC.md §5.1/§5.2's "a few seconds" debounce and an explicit concurrency cap (this
// file's own header comment on why both are needed). One instance for the whole process,
// mirroring `$lib/server/db.ts`'s single connection handle.
const productionQueue = createCanonSaveJobQueue({ debounceMs: 4000, maxConcurrent: 3 });

/** Every human-authored canon write calls this after its own transaction commits - never
 * before, since the debounce window should measure from "the save is durable", not from
 * when the request started. Fire and forget: the caller's response is never held up on
 * this, which is the whole point of SPEC.md §5.1/§5.2's "in the background". */
export function scheduleCanonSaveJob(input: CanonSaveJobInput): void {
	productionQueue.schedule(input);
}

/** Every completed job for the production queue, newest last - bounded like
 * `table-stream.ts`'s own backlog. The "a failed run must leave a record a human can find"
 * requirement's introspection half: not a UI (none was asked for), but a stable place to
 * look, and what a future admin surface (`docs/ux` F5) would read. */
export function recentCanonSaveJobs(limit?: number): CanonSaveJobResult[] {
	return productionQueue.recentJobs(limit);
}
