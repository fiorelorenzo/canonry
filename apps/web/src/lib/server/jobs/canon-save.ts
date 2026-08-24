/**
 * SPEC.md §5.1/§5.2: propagation and audit run "on save, debounced, in the background."
 * This is the ignition the rest of `packages/copilot` never got wired to: every route
 * that writes a human-authored `revision` calls `scheduleCanonSaveJob` after its own
 * transaction commits, and this file is what actually runs `planPropagation` and
 * `runAudit` against that save, off the request/response cycle, through the durable
 * poll/claim/lease machinery in `queue.ts` and the Postgres access in `store.ts`.
 *
 * Issue #115: the first version of this trigger kept its debounce window and in-flight
 * set in one process's memory (`queue.ts`'s old `DebouncedJobQueue`), correct for a
 * single container and silently wrong the moment a second one exists, or the one
 * container restarts mid-run. `store.ts`'s `canon_save_job` table is what fixes both: a
 * row per pending job, `run_after` for the (now cross-instance) debounce, and a lease so
 * a crashed worker's job comes back instead of evaporating.
 *
 * `db`/`modelFactory`/`gateway` used to travel inside every scheduled job's own input,
 * because the in-memory queue ran a job in the same process that scheduled it. Neither a
 * live database handle nor an injected model factory can survive a restart or cross a
 * process boundary through a Postgres row, so they moved to `createCanonSaveJobQueue`'s
 * construction instead - supplied once, by whichever process is actually running the
 * worker, the same way `$lib/server/db.ts`'s `db()` and `$lib/server/copilot.ts`'s
 * `modelFactory` are process-level singletons already. `CanonSaveJobInput` (`store.ts`)
 * keeps only what a Postgres row can actually hold.
 *
 * Two engines, two independent outcomes per job - a failure in one never blocks the
 * other, and both check guardrail 4 and spend independently before either runs
 * (`requireAiEnabled` is the first line of both `planPropagation` and `runAudit` in
 * `@canonry/copilot`, so "no spend while AI is off" holds without this file re-checking
 * it - re-checking it here would just be a second place for that rule to drift from the
 * first).
 *
 * What this file deliberately does NOT call: `generatePlanDiffs`. Decision C3
 * (`docs/design/DECISIONS.md`) is "flat checklist, entries droppable before any diff is
 * written", and `docs/ux/c3-propagation-plan.html`'s own "Rejected outright" section named (in git history at c84c8f8)
 * the alternative by hand: "generate every diff first, let the GM delete what they do not
 * want after ... burns the premium model's writes on entries nobody asked to see." The
 * plan detail route (`w/[universe]/proposals/[plan]/+page.server.ts`'s `generateDiffs`
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
import { DEFAULT_LOCALE, toLocale, type Locale } from '@canonry/lang';
import { AiDisabledError, planPropagation, runAudit } from '@canonry/copilot';
import type { GatewayWrapper, ModelFactory } from '@canonry/copilot';
import { createEmbeddingModel, ModelNotConfiguredError, resolveModel } from '@canonry/ai';
import {
	createGatewayEmbedder,
	heuristicExtractor,
	indexEntity,
	resolveOwnCanonCollection,
	type EmbeddingModelFactory
} from '@canonry/indexing';
import type { QdrantClient } from '@canonry/vector';
import { propagationCapForUniverse, type Db } from '@canonry/db';
import { db } from '$lib/server/db';
import { identityGateway, modelFactory, vectorClient } from '$lib/server/copilot';
import { DurableJobPoller, type DurableQueueHandlers } from './queue.js';
import {
	claimNextCanonSaveJob,
	completeCanonSaveJob,
	recentCanonSaveJobRows,
	scheduleCanonSaveJobRow,
	statusesFor,
	type CanonSaveJobRow
} from './store.js';
import type {
	CanonSaveJobInput,
	CanonSaveJobResult,
	EngineOutcome,
	IndexOutcome
} from './store.js';

export type {
	CanonSaveJobInput,
	CanonSaveJobResult,
	EngineOutcome,
	IndexOutcome
} from './store.js';

interface EngineRunInput {
	db: Db;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	universeId: string;
	entityId: string;
	entityName: string;
	userId: string;
	oldBody: string;
	newBody: string;
	triggerRevisionId: string | null;
	/** SPEC.md §17: the language the propagation and audit speech comes back in, captured from
	 * the request that scheduled this rather than resolved when it runs, because negotiation
	 * reads a cookie and a header the worker will never see. */
	locale: Locale;
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
function logEngineFailure(
	err: unknown,
	universeId: string,
	entityId: string,
	engine: 'propagate.plan' | 'audit.flag' | 'index.entity'
): { errorName: string; message: string } {
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
	return { errorName, message };
}

function describeEngineFailure(
	err: unknown,
	universeId: string,
	entityId: string,
	engine: 'propagate.plan' | 'audit.flag'
): EngineOutcome {
	if (err instanceof AiDisabledError) return { status: 'ai-disabled' };
	return { status: 'error', ...logEngineFailure(err, universeId, entityId, engine) };
}

/** Decision C3 amendment: reads the universe's own `propagation_cap` before planning,
 * rather than letting `planPropagation` fall back to its own default - a job here
 * always knows which universe it is running for, so there is no excuse for the GM's
 * setting not to apply. Null (no limit) passes straight through; `planPropagation`
 * is what decides that means no truncation. */
async function runPropagationEngine(input: EngineRunInput): Promise<EngineOutcome> {
	try {
		const cap = await propagationCapForUniverse(input.db, input.universeId);
		const result = await planPropagation({
			db: input.db,
			userId: input.userId,
			universeId: input.universeId,
			editedEntityId: input.entityId,
			editedEntityName: input.entityName,
			oldBody: input.oldBody,
			newBody: input.newBody,
			triggerRevisionId: input.triggerRevisionId,
			locale: input.locale,
			modelFactory: input.modelFactory,
			gateway: input.gateway,
			cap
		});
		return result ? { status: 'ok', planId: result.plan.id } : { status: 'no-change' };
	} catch (err) {
		return describeEngineFailure(err, input.universeId, input.entityId, 'propagate.plan');
	}
}

async function runAuditEngine(input: EngineRunInput): Promise<EngineOutcome> {
	try {
		const result = await runAudit({
			db: input.db,
			userId: input.userId,
			universeId: input.universeId,
			editedEntityId: input.entityId,
			oldBody: input.oldBody,
			newBody: input.newBody,
			locale: input.locale,
			modelFactory: input.modelFactory,
			gateway: input.gateway
		});
		return result.plan ? { status: 'ok', planId: result.plan.id } : { status: 'no-change' };
	} catch (err) {
		return describeEngineFailure(err, input.universeId, input.entityId, 'audit.flag');
	}
}

/** Issue #164: the third engine a save's job runs - chunk/extract/embed/upsert of the
 * entity's own body into its universe's own-canon lore collection, deleting its stale
 * points first. Rides the same debounced, durable, per-(universe, entity) worker
 * propagation and audit already use, which is the obvious place for it: it already runs
 * off every human save, off the request/response cycle, with a lease that retries a
 * crashed run - so a slow or failed embed here can never make the save itself slow or
 * fail, because this worker only ever starts after the save's own transaction and HTTP
 * response have already finished.
 *
 * Never gated on `aiEnabled`, unlike propagation and audit: embedding for search is
 * reading infrastructure, not generation - the same reasoning `@canonry/copilot`'s
 * `searchIndexed` (Ask's own indexed-retrieval layer) already follows, since it runs
 * unconditionally, before that file's `aiEnabled` check exists at all. Guardrail 4 is
 * about the AI that writes canon, not about whether a homebrew world can find its own
 * canon again. `heuristicExtractor` (no model call) does the chunk metadata pass, so the
 * embedding call is the only thing here that touches the gateway - charged at zero
 * credits through `operation_price`'s existing `index.embed` row (issue #164's own note:
 * "charging for indexing a save would tax the act of saving").
 *
 * A body that did not actually change is `no-change`, not a failed run - so is a universe
 * with no `embedding` purpose configured yet (a fresh deployment, the same state
 * `searchIndexed` already treats as normal rather than an error). Anything else that goes
 * wrong - the gateway down, a missing credential, a dimension mismatch - is caught here
 * and recorded as `error`, never rethrown: the `Promise.all` below can never let an
 * embedding failure take propagation or audit down with it, and a job whose only trouble
 * was indexing still completes `done`. */
async function runIndexEngine(
	input: EngineRunInput,
	deps: { vectorClient: QdrantClient; embeddingModelFactory: EmbeddingModelFactory }
): Promise<IndexOutcome> {
	if (input.oldBody === input.newBody) return { status: 'no-change' };
	try {
		let embeddingModel;
		try {
			embeddingModel = await resolveModel(input.db, 'embedding');
		} catch (err) {
			if (err instanceof ModelNotConfiguredError) return { status: 'no-change' };
			throw err;
		}
		const { collectionName, vectorSize, dataSourceId } = await resolveOwnCanonCollection(
			input.db,
			input.universeId,
			embeddingModel
		);
		const embedder = createGatewayEmbedder({
			db: input.db,
			model: { ...embeddingModel, model: deps.embeddingModelFactory(embeddingModel) },
			userId: input.userId,
			universeId: input.universeId,
			operation: 'index.embed'
		});
		const result = await indexEntity(
			{ db: input.db, vectorClient: deps.vectorClient, extractor: heuristicExtractor, embedder },
			{
				dataSourceId,
				universeId: input.universeId,
				entityId: input.entityId,
				entityName: input.entityName,
				body: input.newBody,
				collectionName,
				vectorSize
			}
		);
		return { status: 'ok', chunkCount: result.chunkCount };
	} catch (err) {
		return {
			status: 'error',
			...logEngineFailure(err, input.universeId, input.entityId, 'index.entity')
		};
	}
}

const RECENT_JOBS_LIMIT = 200;
// SPEC.md §5.1/§5.2's "a few seconds" debounce, unchanged from the in-memory version.
const DEFAULT_DEBOUNCE_MS = 4000;
const DEFAULT_MAX_CONCURRENT = 3;
// Long enough that a real, slow multi-step model call never outlives its own lease and
// gets reclaimed out from under a worker that is still legitimately running it - the
// manual verification forces a lease to expire early with a direct `UPDATE` instead of
// waiting this out in real time.
const DEFAULT_LEASE_MS = 10 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_ATTEMPTS = 5;

export interface JobQueueOptions {
	/** Quiet period after the last `schedule()` call for a key before its job becomes due
	 * - SPEC.md §5.1/§5.2 says only "debounced", not a number. Authoritative in Postgres
	 * (`run_after`), not a per-process timer, which is the whole point of issue #115: two
	 * instances scheduling the same key still produce one due job, not two. */
	debounceMs: number;
	/** Hard cap on how many jobs this instance runs at once. */
	maxConcurrent: number;
}

export interface CanonSaveJobQueueOptions extends JobQueueOptions {
	db: Db;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	/** Issue #164: the index engine's own two seams, mirroring `modelFactory`/`gateway`
	 * above - a real Qdrant client and a real embedding-model factory in production,
	 * scripted test doubles in `canon-save.test.ts`. */
	vectorClient: QdrantClient;
	embeddingModelFactory: EmbeddingModelFactory;
	/** How long a claim's lease lasts before another worker may reclaim it. */
	leaseMs?: number;
	/** How often an idle worker polls Postgres for the next due job. */
	pollIntervalMs?: number;
	/** Reclaim attempts before a job dead-letters to `failed` instead of being retried
	 * forever. */
	maxAttempts?: number;
}

/** One durable queue's whole public surface: schedule a save, start/stop its worker, and
 * (test/introspection only) wait for everything it scheduled to settle or read what it
 * did. A factory rather than a single module-level singleton so tests can build an
 * isolated queue with a short debounce and lease instead of sharing timing with (or
 * polluting the history of) the production one - both now read the same shared table, so
 * "isolated" means "tracks only the rows this instance's own `schedule()` calls touched",
 * not a private in-memory copy. */
export interface CanonSaveJobQueue {
	schedule(input: CanonSaveJobInput): void;
	/** Starts this instance's worker loop. Idempotent. */
	start(): void;
	/** Graceful shutdown: stops claiming new rows, waits for whatever is in flight to
	 * finish. */
	stop(): Promise<void>;
	waitForIdle(timeoutMs?: number): Promise<void>;
	recentJobs(limit?: number): Promise<CanonSaveJobResult[]>;
}

async function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

export function createCanonSaveJobQueue(options: CanonSaveJobQueueOptions): CanonSaveJobQueue {
	const {
		db: conn,
		modelFactory: factory,
		gateway,
		debounceMs,
		vectorClient: qdrant,
		embeddingModelFactory
	} = options;
	const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const tracked = new Set<string>();
	// `schedule()` fires the insert/upsert and returns immediately (fire-and-forget, same
	// contract the in-memory queue had) - a `waitForIdle()` called right after `schedule()`
	// would otherwise see an empty `tracked` and return before the row even exists. This is
	// what `waitForIdle` drains first, so it always observes the row `schedule()` is still
	// in the middle of writing.
	const pendingSchedules = new Set<Promise<void>>();

	async function runClaimedJob(row: CanonSaveJobRow): Promise<void> {
		const input: EngineRunInput = {
			db: conn,
			modelFactory: factory,
			gateway,
			universeId: row.universeId,
			entityId: row.entityId,
			entityName: row.entityName,
			userId: row.userId,
			oldBody: row.oldBody,
			newBody: row.newBody,
			triggerRevisionId: row.triggerRevisionId,
			// A row written before this column existed reads as English rather than throwing: a
			// queue that refuses to drain after a deploy is worse than one whose oldest jobs
			// answer in the default language.
			locale: toLocale(row.locale) ?? DEFAULT_LOCALE
		};
		const [propagation, audit, index] = await Promise.all([
			runPropagationEngine(input),
			runAuditEngine(input),
			runIndexEngine(input, { vectorClient: qdrant, embeddingModelFactory })
		]);
		await completeCanonSaveJob(conn, row.id, { propagation, audit, index });
	}

	const handlers: DurableQueueHandlers<CanonSaveJobRow> = {
		claimNext: (leaseHolder) => claimNextCanonSaveJob(conn, { leaseHolder, leaseMs, maxAttempts }),
		run: (row) =>
			runClaimedJob(row).catch((err) => {
				// Defensive only, mirroring the old in-memory queue's own `runWithSlot` catch:
				// both engine calls already catch their own errors into an `EngineOutcome`, so
				// reaching here means `completeCanonSaveJob` itself failed (a DB error mid-write).
				// The row is left `claimed` - the lease reclaims and retries it exactly like a
				// crashed worker, which is the honest thing to do with a failure this file
				// cannot itself resolve.
				console.error(
					JSON.stringify({
						event: 'canon_save_job_run_failed',
						jobId: row.id,
						universeId: row.universeId,
						entityId: row.entityId,
						message: err instanceof Error ? err.message : String(err)
					})
				);
			})
	};

	const poller = new DurableJobPoller<CanonSaveJobRow>(
		{
			pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
			maxConcurrent: options.maxConcurrent
		},
		handlers
	);
	poller.start();

	return {
		start: () => poller.start(),
		stop: () => poller.stop(),
		schedule(input) {
			const settled = scheduleCanonSaveJobRow(conn, input, debounceMs)
				.then((id) => {
					tracked.add(id);
				})
				.catch((err) => {
					console.error(
						JSON.stringify({
							event: 'canon_save_job_schedule_failed',
							universeId: input.universeId,
							entityId: input.entityId,
							message: err instanceof Error ? err.message : String(err)
						})
					);
				});
			pendingSchedules.add(settled);
			void settled.finally(() => {
				pendingSchedules.delete(settled);
			});
		},
		async waitForIdle(timeoutMs = 5000) {
			const start = Date.now();
			for (;;) {
				await Promise.all(pendingSchedules);
				if (tracked.size > 0) {
					const statuses = await statusesFor(conn, [...tracked]);
					for (const id of [...tracked]) {
						const status = statuses.get(id);
						if (!status || status === 'done' || status === 'failed') tracked.delete(id);
					}
				}
				if (pendingSchedules.size === 0 && tracked.size === 0) return;
				if (Date.now() - start > timeoutMs) {
					throw new Error(`CanonSaveJobQueue.waitForIdle: still not idle after ${timeoutMs}ms`);
				}
				await delay(10);
			}
		},
		recentJobs: (limit) => recentCanonSaveJobRows(conn, limit ?? RECENT_JOBS_LIMIT)
	};
}

// One instance for the whole process, mirroring `$lib/server/db.ts`'s single connection
// handle - constructed lazily rather than at module load, so importing this module (this
// file's own test suite included, which builds its own isolated instances via
// `createCanonSaveJobQueue`) never starts a worker against whatever database happens to be
// configured. `startCanonSaveJobWorker` is what actually starts polling, called once from
// `hooks.server.ts` at process boot (guarded by `building`, same as `$lib/server/auth.ts`'s
// own eager-init pattern) - every replica runs a worker from boot, not only the replica
// that happens to receive a save, which matters because reclaiming a lease another
// replica abandoned cannot depend on this one ever being asked to schedule something
// itself. `scheduleCanonSaveJob` also starts it lazily as a fallback, so a route is never
// wrong to call it even before boot wiring exists.
let productionQueue: CanonSaveJobQueue | undefined;

function getProductionQueue(): CanonSaveJobQueue {
	if (!productionQueue) {
		productionQueue = createCanonSaveJobQueue({
			debounceMs: DEFAULT_DEBOUNCE_MS,
			maxConcurrent: DEFAULT_MAX_CONCURRENT,
			db: db(),
			modelFactory,
			gateway: identityGateway,
			vectorClient: vectorClient(),
			// Mirrors `realModelFactory` in `$lib/server/copilot.ts`: no credentials passed
			// through, so `createEmbeddingModel` falls back to `readGatewayCredentials()`'s own
			// default at call time - the same `MissingGatewayEnvError` a real gateway call
			// throws anywhere else in this codebase when the env var is missing, caught by
			// `runIndexEngine` like any other embedding failure rather than crashing the worker.
			embeddingModelFactory: (resolved) => createEmbeddingModel(resolved.provider, resolved.modelId)
		});
		productionQueue.start();
	}
	return productionQueue;
}

/** Starts this process's canon-save worker. Idempotent - safe to call every request if a
 * caller ever needed to, though `hooks.server.ts` only needs it once, at boot.
 *
 * Refuses to start under vitest, and this is not test-shy production code. Importing
 * `hooks.server.ts` from a test, which `hooks.server.test.ts` legitimately does to assert that
 * a real request ends up with the right locale, would otherwise start a background poller
 * against whatever database that run uses, carrying production's own attempt cap. It then
 * competes for rows with the queues the tests construct themselves, and the symptom is the
 * attempt-cap test watching its dead-letter candidate quietly succeed instead, in one run out
 * of several. A unit-test process has no business running a durable worker. */
export function startCanonSaveJobWorker(): void {
	if (process.env.VITEST) return;
	getProductionQueue();
}

/** Every human-authored canon write calls this after its own transaction commits - never
 * before, since the debounce window should measure from "the save is durable", not from
 * when the request started. Fire and forget: the caller's response is never held up on
 * this, which is the whole point of SPEC.md §5.1/§5.2's "in the background". Starts this
 * process's worker on the first call, so a route never has to know that durability exists. */
export function scheduleCanonSaveJob(input: CanonSaveJobInput): void {
	getProductionQueue().schedule(input);
}

/** Every completed (or dead-lettered) job for the production queue, newest last - a
 * direct read against `canon_save_job`, independent of whether this process's own worker
 * is running, since another instance may have claimed and finished a row this one merely
 * scheduled. The "a failed run must leave a record a human can find" requirement's
 * introspection half: not a UI (none was asked for), but a stable place to look, and what
 * a future admin surface (`docs/ux` F5) would read. */
export function recentCanonSaveJobs(limit?: number): Promise<CanonSaveJobResult[]> {
	return recentCanonSaveJobRows(db(), limit ?? RECENT_JOBS_LIMIT);
}
