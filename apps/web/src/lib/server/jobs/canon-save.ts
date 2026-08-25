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
 * that never imports this module. So an accept can never re-trigger propagation on itself.
 *
 * Issue #703 made the import accept route import this module after all, to index the entity
 * it just created, so "these two share no call edge" is no longer the whole guarantee and the
 * replacement has to be as hard to get wrong. It is `scheduleEntityIndexJob` and its own
 * input type: no `oldBody`, no `newBody`, no `triggerRevisionId`, so the row it writes names
 * no diff, and both `planPropagation` and `runAudit` return on an empty `semanticDiff` before
 * any model call. An accept cannot ask for propagation because the function it is given
 * cannot express it, which is still the type system rather than a flag two files keep in sync.
 * `canon-save.test.ts` has a test per half: the accept still schedules no save job, and an
 * index-only schedule runs the index engine with propagation and audit both `no-change` and
 * zero `model_call` rows.
 *
 * Issue #709: a second durable loop lives here now, and it is a catch-up rather than a third
 * engine. The index engine resolves the `embedding` purpose per run, so a universe with no
 * active `model_config` row indexes nothing; #703 made that state visible
 * (`index_outcome = {"status":"no-embedding-model"}`) and named the fact that nothing ever
 * came back for it. What comes back is `sweepIndexBackfills` plus `runBackfill`: the sweep
 * asks, on a timer, whether an `embedding` row now resolves and any universe has skipped
 * since its last catch-up, and a pass over `universe_index_backfill` enumerates that
 * universe's entries against its own collection and fans out one index-only job per entry
 * that has no entity-level point. Two things about it are worth knowing here rather than
 * downstream. The trigger is not a save, because `resolveModel` takes no universe and so the
 * condition is global - nobody's edit pays for the catch-up. And the enumeration reads the
 * collection rather than the `canon_save_job` rows, because a job row records what one run
 * skipped and there are four ways an entry is genuinely missing with no such row to read
 * (`unindexedEntities` in `@canonry/indexing` carries the list).
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
	unindexedEntities,
	type EmbeddingModelFactory
} from '@canonry/indexing';
import type { QdrantClient } from '@canonry/vector';
import { matchTextFor, oneLineSummary } from '@canonry/import';
import {
	entityIndexCandidatesForUniverse,
	entityIndexTargetById,
	entityIndexTargetByRevisionId,
	propagationCapForUniverse,
	type Db
} from '@canonry/db';
import { db } from '$lib/server/db';
import { identityGateway, modelFactory, vectorClient } from '$lib/server/copilot';
import { DurableJobPoller, type DurableQueueHandlers } from './queue.js';
import {
	claimNextCanonSaveJob,
	completeCanonSaveJob,
	entitiesSkippedForNoEmbeddingModel,
	recentCanonSaveJobRows,
	scheduleCanonSaveJobRow,
	scheduleEntityIndexJobRow,
	statusesFor,
	type CanonSaveJobRow
} from './store.js';
import type {
	CanonSaveJobInput,
	CanonSaveJobResult,
	EngineOutcome,
	EntityIndexJobInput,
	IndexOutcome
} from './store.js';
import {
	claimNextIndexBackfill,
	completeIndexBackfill,
	enqueueDueIndexBackfills,
	recentIndexBackfills,
	requeueIndexBackfill,
	resumeIndexBackfill,
	scheduleBackfillIndexJobRows,
	type BackfillIndexJobRow,
	type UniverseIndexBackfillRow
} from './backfill-store.js';

export type {
	CanonSaveJobInput,
	CanonSaveJobResult,
	EngineOutcome,
	EntityIndexJobInput,
	IndexOutcome
} from './store.js';

export type { UniverseIndexBackfillRow } from './backfill-store.js';

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
 * Reads the entity rather than the job row, since issue #703. The row's `old_body`/`new_body`
 * exist so propagation and audit see the burst they were scheduled for; indexing has no
 * business with a diff, its job is to make the collection agree with what the entry now says,
 * and the name, the aliases and the type it also has to embed were never on that row at all.
 * The `oldBody === newBody` short-circuit this used to open with went with it: it saved one
 * embedding call on a save that changed nothing, and it silently indexed nothing at all for a
 * job scheduled by anything other than an editor save (`scheduleEntityIndexJob`, whose rows
 * carry no bodies by construction).
 *
 * An entity that has been deleted since the job was scheduled is `no-change`. A universe with
 * no `embedding` row in `model_config` is `no-embedding-model`, which is a status of its own
 * and a log line carrying how many entities of that universe it has now happened to, because
 * the old behaviour (report `no-change`, index nothing, never revisit) is a whole world
 * quietly missing from retrieval with nothing anywhere saying so. Anything else that goes
 * wrong - the gateway down, a missing credential, a dimension mismatch - is caught here and
 * recorded as `error`, never rethrown: the `Promise.all` below can never let an embedding
 * failure take propagation or audit down with it, and a job whose only trouble was indexing
 * still completes `done`. */
async function runIndexEngine(
	input: EngineRunInput,
	deps: { vectorClient: QdrantClient; embeddingModelFactory: EmbeddingModelFactory }
): Promise<IndexOutcome> {
	try {
		const target = await entityIndexTargetById(input.db, input.entityId);
		if (!target) return { status: 'no-change' };

		let embeddingModel;
		try {
			embeddingModel = await resolveModel(input.db, 'embedding');
		} catch (err) {
			if (!(err instanceof ModelNotConfiguredError)) throw err;
			const entities = await entitiesSkippedForNoEmbeddingModel(
				input.db,
				input.universeId,
				input.entityId
			);
			console.warn(
				JSON.stringify({
					event: 'canon_save_job_index_skipped',
					reason: 'no-embedding-model',
					universeId: input.universeId,
					entityId: input.entityId,
					// The number that turns one skipped entry into a statement about the universe:
					// nothing re-indexes what was skipped when an `embedding` row does appear later
					// (issue #709), so this is how many entries stay unfindable until somebody edits
					// each one by hand.
					entitiesSkippedInUniverse: entities
				})
			);
			return { status: 'no-embedding-model' };
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
				entityId: target.id,
				entityName: target.name,
				body: target.body,
				entityType: target.type,
				// The merge engine's own definition of "how one side of a match reads", so the
				// entity-level point's vector is comparable to what `bandedSimilarity` embeds
				// rather than merely similar in spirit. Same shape `job-runner.ts` builds for an
				// already-imported candidate: name and aliases, then its type and the first line
				// of its body, and no source sentence, because an entity has no source text kept
				// anywhere to quote.
				entityMatchText: matchTextFor({
					name: target.name,
					aliases: target.aliases,
					context: {
						type: target.type,
						summary: oneLineSummary(target.body),
						sourceSentence: null
					}
				}),
				collectionName,
				vectorSize
			}
		);
		return {
			status: 'ok',
			chunkCount: result.chunkCount,
			entityPointWritten: result.entityPointWritten
		};
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

/**
 * Issue #709's bound on the fan-out, and the reasoning behind the two numbers.
 *
 * The fan-out itself is a loop over the row `scheduleEntityIndexJob` already writes, so the
 * question is not how to do the work but at what rate it is allowed to happen. Three
 * candidates for the binding constraint, priced:
 *
 * - **Money.** `alibaba/qwen3-embedding-4b` is $0.020 per million tokens and an entity's
 *   name-and-aliases text is under a hundred tokens, so two thousand entries is about
 *   200k tokens, or **$0.004**, plus whatever their bodies come to. It is not the constraint,
 *   and `index.embed` is priced at zero credits anyway (issue #164: charging for indexing a
 *   save would tax the act of saving), so none of it reaches a GM's balance.
 * - **The gateway's rate limit.** Real, and unknown at this layer.
 * - **Fairness against ordinary saves.** The binding one. `claimNextCanonSaveJob` orders by
 *   `run_after`, so two thousand rows all due at once sit ahead of every save made in the
 *   next several minutes, and a GM's propagation would wait behind a catch-up they did not
 *   ask for. That is the same failure the issue names about the *triggering* save, one layer
 *   down.
 *
 * So the bound is a stagger rather than a sleep: `DEFAULT_BACKFILL_SCHEDULE_BATCH` rows share
 * a `run_after`, the next batch is `DEFAULT_BACKFILL_STAGGER_MS` later, and the existing
 * scheduler does the rate limiting. A save made during a backfill is due immediately and
 * therefore sorts ahead of every batch that has not come due yet, so it waits for at most the
 * batch already running. Five entries a second is also the order of what three concurrent
 * workers can actually embed, so the queue drains rather than growing a backlog.
 */
const DEFAULT_BACKFILL_SCHEDULE_BATCH = 25;
const DEFAULT_BACKFILL_STAGGER_MS = 5000;
/** One pass schedules at most this many, then requeues itself for the rest. Two thousand
 * entries is the size the issue names and fits in one pass (400s of stagger); the cap exists
 * so a world an order of magnitude larger is still a sequence of bounded passes rather than
 * one statement holding fifty thousand rows and a lease for three hours. */
const BACKFILL_MAX_PER_PASS = 2000;
/** Margin on top of a pass's stagger span before the verification pass re-enumerates. A
 * backfill is only `done` once an enumeration comes back empty (see `runBackfill`), so every
 * pass that scheduled something comes back to check; this is how long it waits. Long enough
 * that the last batch's jobs have been claimed and run, short enough that a universe with a
 * genuinely stuck entry reaches its attempt cap in minutes rather than hours. */
const DEFAULT_BACKFILL_VERIFY_DELAY_MS = 10_000;
/** How often the worker asks whether any universe is owed a catch-up. The trigger is the
 * first successful `resolveModel(db, 'embedding')` after a run that skipped; `resolveModel`
 * takes no universe, so that condition is global and the worker can ask it on a timer instead
 * of waiting for somebody to save an entry. A minute is well inside the time it takes an
 * operator to notice their own Ask answers are thin, and `resolveModel` caches for 30s, so the
 * ordinary cost of asking is a map lookup and one empty partial-index scan. */
const DEFAULT_BACKFILL_SWEEP_INTERVAL_MS = 60_000;
/** The backfill poller's own idle poll. Slower than the save poller's 500ms because nothing
 * about a catch-up is latency-sensitive, and this is a second loop querying the same
 * database. */
const DEFAULT_BACKFILL_POLL_INTERVAL_MS = 5000;
/** A backfill pass is an enumeration and one insert: seconds, not the ten minutes a model
 * call can legitimately take, so it gets its own much shorter lease. */
const DEFAULT_BACKFILL_LEASE_MS = 2 * 60_000;
/** How long a thrown pass waits before its lease is reclaimed. */
const BACKFILL_RETRY_MS = 30_000;
/** And how long to wait when the `embedding` row vanished again between the sweep enqueuing
 * this backfill and the worker claiming it. Not an error: there is nothing to index against,
 * and the row correctly stays owed. */
const BACKFILL_NO_MODEL_RETRY_MS = 60_000;
const RECENT_BACKFILLS_LIMIT = 50;

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
	/** Issue #709's own knobs, all defaulted (`DEFAULT_BACKFILL_*` above). Overridden only by
	 * `canon-save.test.ts`: it needs a sweep it can drive rather than one that fires while an
	 * assertion is running, and it has no reason to spend the production stagger and
	 * verification margin in real seconds to prove they are applied. */
	backfillSweepIntervalMs?: number;
	backfillPollIntervalMs?: number;
	backfillLeaseMs?: number;
	backfillStaggerMs?: number;
	backfillVerifyDelayMs?: number;
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
	/** Issue #703: schedules the same durable row for the index engine alone. What an import
	 * accept and the entries list's "New entry" call, neither of which may run propagation or
	 * audit - see `EntityIndexJobInput` on why the shape rather than a flag is the guard. */
	scheduleIndexOnly(input: EntityIndexJobInput): void;
	/**
	 * Issue #709: runs the backfill sweep once, now, and answers which universes it enqueued.
	 *
	 * The worker calls this on its own timer, so nothing in the product needs it. It is here
	 * because "the trigger fired" and "the catch-up ran" are two different claims and a test
	 * that cannot separate them proves neither. Answers an empty array when no `embedding` row
	 * is configured, which is the state the whole feature is about.
	 */
	sweepIndexBackfills(): Promise<string[]>;
	/** Settles when no backfill row is `pending` or `claimed` any more - the backfill half of
	 * `waitForIdle`, and note that a *scheduled* backfill is idle by this measure: its work is
	 * now `canon_save_job` rows, which `waitForIdle` is what waits on.
	 *
	 * `universeId` is not optional in practice: this table is shared, the sweep is global by
	 * design (an `embedding` row appearing is one global fact), so a caller that waits on every
	 * universe waits on whatever else is going on in the same database. */
	waitForBackfillIdle(universeId?: string, timeoutMs?: number): Promise<void>;
	/** Every backfill row, newest first, optionally for one universe. Introspection only. */
	recentBackfills(universeId?: string, limit?: number): Promise<UniverseIndexBackfillRow[]>;
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
	const backfillLeaseMs = options.backfillLeaseMs ?? DEFAULT_BACKFILL_LEASE_MS;
	const backfillSweepIntervalMs =
		options.backfillSweepIntervalMs ?? DEFAULT_BACKFILL_SWEEP_INTERVAL_MS;
	const backfillStaggerMs = options.backfillStaggerMs ?? DEFAULT_BACKFILL_STAGGER_MS;
	const backfillVerifyDelayMs = options.backfillVerifyDelayMs ?? DEFAULT_BACKFILL_VERIFY_DELAY_MS;
	// Zero rather than "now", so the first idle poll after start sweeps instead of waiting out
	// a whole interval: a process that boots with a backfill already owed should not sit on it.
	let lastSweepAt = 0;
	const tracked = new Set<string>();
	// `schedule()` fires the insert/upsert and returns immediately (fire-and-forget, same
	// contract the in-memory queue had) - a `waitForIdle()` called right after `schedule()`
	// would otherwise see an empty `tracked` and return before the row even exists. This is
	// what `waitForIdle` drains first, so it always observes the row `schedule()` is still
	// in the middle of writing.
	const pendingSchedules = new Set<Promise<void>>();

	/** Both `schedule` and `scheduleIndexOnly` are fire-and-forget and both have to leave the
	 * row's id where `waitForIdle` can see it, including while the insert is still in flight. */
	function trackSchedule(row: Promise<string>, universeId: string, entityId: string): void {
		const settled = row
			.then((id) => {
				tracked.add(id);
			})
			.catch((err) => {
				console.error(
					JSON.stringify({
						event: 'canon_save_job_schedule_failed',
						universeId,
						entityId,
						message: err instanceof Error ? err.message : String(err)
					})
				);
			});
		pendingSchedules.add(settled);
		void settled.finally(() => {
			pendingSchedules.delete(settled);
		});
	}

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

	/**
	 * Issue #709's trigger: the first successful `resolveModel(db, 'embedding')` after a run
	 * that skipped.
	 *
	 * The issue's own framing was that this fires inside `runIndexEngine`, on the next save
	 * after the row appears, and warned that the fan-out must not be paid for by whoever made
	 * that save. `resolveModel` takes no universe, so "an embedding row appeared" is one global
	 * condition rather than a per-universe one, which means the worker can ask it on its own
	 * timer and there is no triggering save at all: nobody's edit pays for the catch-up, not
	 * even in the background, and a universe whose GM adds the model and then does nothing is
	 * still caught up rather than waiting for their next keystroke.
	 *
	 * When no row is configured this does nothing at all - not even the enqueue read. That is
	 * the state the whole feature is about, and it is also the state in which enqueuing a
	 * backfill would be a row that can only be requeued until a model appears.
	 */
	async function sweepIndexBackfills(): Promise<string[]> {
		lastSweepAt = Date.now();
		try {
			await resolveModel(conn, 'embedding');
		} catch (err) {
			if (err instanceof ModelNotConfiguredError) return [];
			throw err;
		}
		const enqueued = await enqueueDueIndexBackfills(conn);
		for (const universeId of enqueued) {
			console.warn(
				JSON.stringify({
					event: 'universe_index_backfill_enqueued',
					reason: 'no-embedding-model',
					universeId
				})
			);
		}
		return enqueued;
	}

	/**
	 * One backfill pass: enumerate what this universe is missing from its own collection, then
	 * schedule an index-only job per missing entry with the stagger `BACKFILL_*` describes.
	 *
	 * Reading the collection rather than the `canon_save_job` rows is the load-bearing choice,
	 * and `unindexedEntities`' own comment carries the four ways a job row misses an entry that
	 * is genuinely absent. The job rows are the trigger, not the work list.
	 *
	 * Idempotent by construction, which is what makes the lease safe: a pass that dies halfway
	 * is reclaimed and re-enumerates, and the entries the dead pass already scheduled either
	 * have their point by then (so they are not missing any more) or still have a pending row
	 * (so `on conflict do nothing` skips them).
	 */
	async function runBackfill(row: UniverseIndexBackfillRow): Promise<void> {
		let embeddingModel;
		try {
			embeddingModel = await resolveModel(conn, 'embedding');
		} catch (err) {
			if (!(err instanceof ModelNotConfiguredError)) throw err;
			// The row was deactivated again between the sweep and this claim. The catch-up is
			// still owed, so the row stays owed too.
			await requeueIndexBackfill(conn, row.id, {
				message: 'no active embedding model at claim time',
				retryMs: BACKFILL_NO_MODEL_RETRY_MS
			});
			return;
		}

		const { collectionName, dataSourceId } = await resolveOwnCanonCollection(
			conn,
			row.universeId,
			embeddingModel
		);
		const candidates = await entityIndexCandidatesForUniverse(conn, row.universeId);
		const { missing, indexed, orphanedPoints } = await unindexedEntities(
			{ vectorClient: qdrant },
			{
				collectionName,
				universeId: row.universeId,
				dataSourceId,
				entityIds: candidates.map((candidate) => candidate.id)
			}
		);

		const nameById = new Map(candidates.map((candidate) => [candidate.id, candidate.name]));
		const pass = missing.slice(0, BACKFILL_MAX_PER_PASS);
		const jobRows: BackfillIndexJobRow[] = pass.map((entityId, i) => ({
			entityId,
			entityName: nameById.get(entityId) ?? entityId,
			delayMs: Math.floor(i / DEFAULT_BACKFILL_SCHEDULE_BATCH) * backfillStaggerMs
		}));
		// The locale of a backfill is nobody's: there is no actor and nothing it schedules will
		// ever produce speech, because propagation and audit return on the empty diff these rows
		// carry. Default rather than invented.
		const scheduled = await scheduleBackfillIndexJobRows(
			conn,
			row.universeId,
			DEFAULT_LOCALE,
			jobRows
		);
		// How far past "now" the last batch comes due, plus a margin for the last job to actually
		// run - which is how long a resumed pass has to wait before re-enumerating usefully.
		const spanMs =
			jobRows.length === 0 ? 0 : (jobRows[jobRows.length - 1]!.delayMs ?? 0) + backfillStaggerMs;
		const capped = missing.length > pass.length;
		const counts = {
			entitiesTotal: candidates.length,
			entitiesMissing: missing.length,
			scheduled
		};

		// **A backfill is done when the enumeration comes back empty, never when a pass has
		// scheduled everything it found.** Scheduling is not indexing: a job can still fail, and
		// because the sweep's watermark has already moved past this universe's skips, a backfill
		// that reported `done` on a pass whose jobs then failed would leave those entries out of
		// retrieval permanently - which is the bug this whole feature exists to fix, one level
		// down. It is not hypothetical either: see `resumeIndexBackfill`'s own comment.
		//
		// The pass line is logged after the decision rather than before it (#745), because
		// `outcome` is the decision: a pass that ends the backfill used to report `verifying`,
		// which was the one thing it was not doing.
		const logPass = (outcome: 'done' | 'capped' | 'verifying' | 'gave-up'): void => {
			console.warn(
				JSON.stringify({
					event: 'universe_index_backfill_scheduled',
					backfillId: row.id,
					universeId: row.universeId,
					attemptCount: row.attemptCount,
					entitiesTotal: candidates.length,
					entitiesIndexed: indexed,
					entitiesMissing: missing.length,
					entitiesScheduledThisPass: scheduled,
					// Non-zero means an entity was deleted without `deleteEntityLoreChunks` running
					// for it. Nothing here repairs that; it is reported so that it is not invisible.
					orphanedEntityPoints: orphanedPoints,
					staggerSpanSeconds: Math.round(spanMs / 1000),
					outcome
				})
			);
		};

		if (missing.length === 0) {
			await completeIndexBackfill(conn, row.id, counts);
			logPass('done');
			return;
		}
		const resumed = await resumeIndexBackfill(conn, row.id, {
			...counts,
			nextRunAfterMs: spanMs + backfillVerifyDelayMs,
			// A capped pass has different work waiting, and a pass that reduced the shortfall is
			// draining even if it is not finished. `resumeIndexBackfill` owns that second half,
			// because only it can see what the previous pass recorded.
			capped,
			maxAttempts
		});
		logPass(resumed.deadLettered ? 'gave-up' : capped ? 'capped' : 'verifying');
		if (resumed.deadLettered) {
			// Same event as the claim path's lease dead-letter, because it is the same fact for
			// whoever is grepping: this universe is not going to be indexed without a human. The
			// two are told apart by `last_error` on the row.
			console.error(
				JSON.stringify({
					event: 'universe_index_backfill_dead_lettered',
					backfillId: row.id,
					universeId: row.universeId,
					attemptCount: resumed.attemptCount,
					entitiesMissing: missing.length,
					cause: 'no-progress'
				})
			);
		}
	}

	const backfillHandlers: DurableQueueHandlers<UniverseIndexBackfillRow> = {
		async claimNext(leaseHolder) {
			if (Date.now() - lastSweepAt >= backfillSweepIntervalMs) {
				// The sweep must never take the loop down with it: a transient database error here
				// would otherwise stop this instance claiming backfills at all.
				await sweepIndexBackfills().catch((err) => {
					console.error(
						JSON.stringify({
							event: 'universe_index_backfill_sweep_failed',
							message: err instanceof Error ? err.message : String(err)
						})
					);
					return [];
				});
			}
			return claimNextIndexBackfill(conn, {
				leaseHolder,
				leaseMs: backfillLeaseMs,
				maxAttempts
			});
		},
		run: (row) =>
			runBackfill(row).catch(async (err) => {
				const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
				console.error(
					JSON.stringify({
						event: 'universe_index_backfill_failed',
						backfillId: row.id,
						universeId: row.universeId,
						attemptCount: row.attemptCount,
						message
					})
				);
				// Recorded on the row and left `claimed` with a short lease, so the claim above
				// reclaims it and the attempt cap eventually dead-letters it - the same handling a
				// crashed pass gets, rather than a second failure path.
				await requeueIndexBackfill(conn, row.id, { message, retryMs: BACKFILL_RETRY_MS }).catch(
					() => undefined
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

	// Its own poller rather than a second handler on the one above, because the two have
	// nothing in common at runtime: a save's job is a model call whose fair share of three
	// slots matters, and a backfill pass is one enumeration and one insert that must not be
	// able to occupy any of those slots. `maxConcurrent: 1` because two passes over the same
	// universe would be redundant and two over different universes would still serialise on
	// the same Qdrant scroll for no gain. `queue.ts` was written generic for exactly this.
	const backfillPoller = new DurableJobPoller<UniverseIndexBackfillRow>(
		{
			pollIntervalMs: options.backfillPollIntervalMs ?? DEFAULT_BACKFILL_POLL_INTERVAL_MS,
			maxConcurrent: 1
		},
		backfillHandlers
	);
	backfillPoller.start();

	return {
		start: () => {
			poller.start();
			backfillPoller.start();
		},
		stop: async () => {
			await Promise.all([poller.stop(), backfillPoller.stop()]);
		},
		schedule(input) {
			trackSchedule(
				scheduleCanonSaveJobRow(conn, input, debounceMs),
				input.universeId,
				input.entityId
			);
		},
		scheduleIndexOnly(input) {
			trackSchedule(
				scheduleEntityIndexJobRow(conn, input, debounceMs),
				input.universeId,
				input.entityId
			);
		},
		sweepIndexBackfills,
		async waitForBackfillIdle(universeId, timeoutMs = 10_000) {
			const start = Date.now();
			for (;;) {
				const open = await recentIndexBackfills(conn, RECENT_BACKFILLS_LIMIT, universeId);
				if (!open.some((row) => row.status === 'pending' || row.status === 'claimed')) return;
				if (Date.now() - start > timeoutMs) {
					throw new Error(
						`CanonSaveJobQueue.waitForBackfillIdle: still not idle after ${timeoutMs}ms`
					);
				}
				await delay(25);
			}
		},
		recentBackfills: (universeId, limit) =>
			recentIndexBackfills(conn, limit ?? RECENT_BACKFILLS_LIMIT, universeId),
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

/**
 * Issue #703: the same durable row, for the index engine alone.
 *
 * Called by the two paths that create or rewrite an entity without a human-authored
 * `revision` behind it: an import proposal's accept (`import/[job]/review`) and the entries
 * list's "New entry" (`entries/+page.server.ts`). Before this, neither was ever indexed -
 * the accept deliberately, because scheduling a save's job off an accepted AI write is what
 * the recursion guard forbids, and the entries-list create incidentally, because it writes no
 * body and there was nothing but a body to index. So an entry the GM created and had not yet
 * written could not be cited by the copilot at all, which is the gap the entity-level point
 * closes and the reason this second scheduling surface exists rather than a flag on the
 * first.
 *
 * `EntityIndexJobInput` carries no bodies, so the row it writes has none, so propagation and
 * audit have no diff to run on and return before any model call. That is the whole guard, and
 * it is a property of the type rather than of a caller remembering something.
 */
export function scheduleEntityIndexJob(input: EntityIndexJobInput): void {
	getProductionQueue().scheduleIndexOnly(input);
}

/**
 * The accept sites' one line: schedule the index job for whatever entity this accepted
 * proposal wrote, or do nothing when it wrote none.
 *
 * Every route that accepts a proposal calls this after the accept has committed, the same
 * ordering rule the editor's save follows for `scheduleCanonSaveJob`. Typed on the one field
 * it reads rather than on `ProposalRow`, because `appliedRevisionId` is the whole question: it
 * is null for a relation accept and for a relation-type vocabulary accept, neither of which
 * writes an entity, and it names the revision that created or rewrote one otherwise.
 * `acceptProposal` creates a `create` proposal's entity inside its own transaction without
 * writing the id back onto the proposal row, so the revision is the only link to it.
 *
 * An accepted `update` from a propagation plan reaches here too, which is wider than issue
 * #703's own wording ("entities created by an import accept") and deliberate: it rewrites a
 * body, so leaving it out would keep the index disagreeing with canon on the most common
 * accept in the product, for no reason other than which issue named it. It cannot trigger
 * propagation for the same structural reason nothing else here can.
 */
export async function scheduleIndexAfterAccept(
	conn: Db,
	accepted: { appliedRevisionId: string | null },
	actor: { userId: string; locale: Locale }
): Promise<void> {
	if (!accepted.appliedRevisionId) return;
	const target = await entityIndexTargetByRevisionId(conn, accepted.appliedRevisionId);
	if (!target) return;
	scheduleEntityIndexJob({
		universeId: target.universeId,
		entityId: target.id,
		entityName: target.name,
		userId: actor.userId,
		locale: actor.locale
	});
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
