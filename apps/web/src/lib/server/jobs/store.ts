/**
 * Durable storage for the canon-save queue (issue #115): every `canon_save_job` read and
 * write lives here, so `canon-save.ts` stays about the two engines and `queue.ts` stays
 * about the generic poll/claim/lease loop - neither the engines nor Postgres belong in
 * that file.
 *
 * The debounce and the concurrency cap moved out of one process's memory into this table
 * on purpose: `run_after` is what makes the debounce window authoritative across every
 * instance instead of per-process, the partial unique index on
 * `(universe_id, entity_id) WHERE status = 'pending'` (`packages/db/src/schema/queue.ts`)
 * is what makes "one pending job per key" atomic instead of a race two instances could
 * both lose, and the lease (`lease_holder`/`lease_expires_at`) is what lets a second
 * worker finish a job a crashed one only claimed.
 */
import { and, desc, eq, inArray, sql, type Db } from '@canonry/db';
import { canonSaveJob, type CanonSaveJobStatus } from '@canonry/db/schema';
import type { Locale } from '@canonry/lang';

export type CanonSaveJobRow = typeof canonSaveJob.$inferSelect;

/** The serializable half of a save: everything a job needs except the process-local
 * `db`/`modelFactory`/`gateway` a durable row can never carry across a restart or a second
 * instance - those are supplied once, at `createCanonSaveJobQueue` construction, by
 * whichever process actually runs the worker (`canon-save.ts`). */
export interface CanonSaveJobInput {
	universeId: string;
	entityId: string;
	entityName: string;
	userId: string;
	oldBody: string;
	newBody: string;
	triggerRevisionId: string | null;
	/** SPEC.md §17: the interface language this save's propagation and audit speech must come
	 * back in, captured now because the worker that runs it cannot see the request's cookie or
	 * Accept-Language header later. */
	locale: Locale;
}

/**
 * Issue #703: what an index-only schedule carries, which is deliberately not a
 * `CanonSaveJobInput`.
 *
 * The recursion guard in `canon-save.ts` used to be structural in the strongest possible
 * sense: the accept path and that module shared no call edge at all, so an accepted AI
 * proposal could not re-trigger propagation on itself however anybody wired it. Indexing an
 * entity created by an import accept means the accept path has to reach the worker, so that
 * exact guarantee cannot survive as written, and the replacement has to be as hard to get
 * wrong. This type is it: an accept route imports `scheduleEntityIndexJob` and this shape,
 * which has no `oldBody`, no `newBody` and no `triggerRevisionId`, so there is no diff for
 * it to name and therefore nothing for propagation or audit to run on. It cannot request
 * them, rather than being trusted not to.
 */
export interface EntityIndexJobInput {
	universeId: string;
	entityId: string;
	entityName: string;
	userId: string;
	/** Only the index engine runs for these jobs, and it needs no locale (SPEC.md §17 is about
	 * the propagation and audit speech). Carried anyway because the row's column is not
	 * nullable in practice for new rows and because a job that is later reported in a UI
	 * should read in the language of whoever caused it. */
	locale: Locale;
}

export type EngineOutcome =
	| { status: 'ok'; planId: string }
	| { status: 'no-change' }
	| { status: 'ai-disabled' }
	| { status: 'error'; errorName: string; message: string };

/**
 * Issue #164: the third engine's outcome, alongside `EngineOutcome` above - shaped
 * differently on purpose rather than shoehorned into it. There is no "plan" for indexing
 * to name (`ok` carries a chunk count instead), and indexing is never gated on
 * `aiEnabled` (embedding for search is reading infrastructure, not generation - see
 * `runIndexEngine`'s own doc comment), so there is no `ai-disabled` case here either.
 *
 * `'no-embedding-model'` is its own status since issue #703, and it used to be folded into
 * `no-change`. That was the failure mode worth naming: a universe with no `embedding` row in
 * `model_config` indexed nothing, said `no-change`, and stayed unindexed at every later
 * point too, so every Ask answer in it degraded with nothing anywhere recording why. An
 * index that is quietly empty is worse than one that is obviously missing. This status is
 * how a reader of `canon_save_job` tells the two apart;
 * `entitiesSkippedForNoEmbeddingModel` below is how they count them, and it is logged once
 * per skipped job with that count on it.
 *
 * `no-change` now means only "the entity is not there any more", which is what a job for an
 * entity deleted between scheduling and running honestly is.
 */
export type IndexOutcome =
	| { status: 'ok'; chunkCount: number; entityPointWritten: boolean }
	| { status: 'no-change' }
	| { status: 'no-embedding-model' }
	| { status: 'error'; errorName: string; message: string };

export interface CanonSaveJobResult {
	universeId: string;
	entityId: string;
	entityName: string;
	startedAt: Date;
	finishedAt: Date;
	propagation: EngineOutcome;
	audit: EngineOutcome;
	index: IndexOutcome;
}

/** Inserts a new pending job, or - if one is still pending for this (universe, entity) -
 * merges into it: the earliest `old_body` of the burst is kept (left out of the `DO
 * UPDATE SET` entirely, on purpose), every other field and `run_after` take this call's
 * value. Once a run starts, the row is no longer `pending`, so the next call for the same
 * key inserts a fresh row rather than merging into the one now running - the durable
 * equivalent of the old queue's "exactly one follow-up" rule, without a settle step: the
 * caller's own `oldBody` already reflects the entity's real body, which no run ever
 * writes to (guardrail 1), so a fresh row's baseline is correct without help. The partial
 * unique index (`canon_save_job_pending_key`) is what makes the merge-vs-insert choice
 * atomic: two instances racing this same upsert for the same key can never both insert.
 * Returns the row's id - the same id for every call inside one still-pending burst. */
export async function scheduleCanonSaveJobRow(
	db: Db,
	input: CanonSaveJobInput,
	debounceMs: number
): Promise<string> {
	const runAfter = new Date(Date.now() + debounceMs);
	const [row] = await db
		.insert(canonSaveJob)
		.values({
			universeId: input.universeId,
			entityId: input.entityId,
			entityName: input.entityName,
			userId: input.userId,
			oldBody: input.oldBody,
			newBody: input.newBody,
			triggerRevisionId: input.triggerRevisionId,
			locale: input.locale,
			runAfter
		})
		.onConflictDoUpdate({
			target: [canonSaveJob.universeId, canonSaveJob.entityId],
			targetWhere: sql`${canonSaveJob.status} = 'pending'`,
			set: {
				entityName: input.entityName,
				userId: input.userId,
				newBody: input.newBody,
				triggerRevisionId: input.triggerRevisionId,
				// A burst that crosses a locale switch takes the latest save's language, which is the
				// one the GM is reading right now.
				locale: input.locale,
				runAfter,
				updatedAt: new Date()
			}
		})
		.returning({ id: canonSaveJob.id });
	if (!row) throw new Error('scheduleCanonSaveJobRow: upsert returned no row');
	return row.id;
}

/**
 * Issue #703: the same row, scheduled for indexing alone.
 *
 * Both bodies are the empty string, and that is what makes propagation and audit no-ops
 * without a flag: `semanticDiff('', '')` is empty, and both engines return before any model
 * call on an empty diff (`planPropagation`, `runAudit` in `@canonry/copilot`). The index
 * engine never reads either field - it reads the entity - so writing nothing into them costs
 * indexing nothing.
 *
 * **The conflict branch deliberately leaves both bodies alone.** A GM saving an entry and an
 * import accept landing on the same entity inside one four-second debounce window is narrow
 * but real, and clobbering that row's `new_body` with an empty string would silently throw
 * away the human save's propagation, which is the one thing this table exists to deliver. So
 * a pending human save absorbs this schedule instead: its own run indexes the entity anyway,
 * because indexing is a thing the worker does for every job rather than a thing this row
 * asks for.
 */
export async function scheduleEntityIndexJobRow(
	db: Db,
	input: EntityIndexJobInput,
	debounceMs: number
): Promise<string> {
	const runAfter = new Date(Date.now() + debounceMs);
	const [row] = await db
		.insert(canonSaveJob)
		.values({
			universeId: input.universeId,
			entityId: input.entityId,
			entityName: input.entityName,
			userId: input.userId,
			oldBody: '',
			newBody: '',
			triggerRevisionId: null,
			locale: input.locale,
			runAfter
		})
		.onConflictDoUpdate({
			target: [canonSaveJob.universeId, canonSaveJob.entityId],
			targetWhere: sql`${canonSaveJob.status} = 'pending'`,
			set: {
				entityName: input.entityName,
				locale: input.locale,
				runAfter,
				updatedAt: new Date()
			}
		})
		.returning({ id: canonSaveJob.id });
	if (!row) throw new Error('scheduleEntityIndexJobRow: upsert returned no row');
	return row.id;
}

/**
 * How many distinct entities in this universe have had a job skip indexing for want of an
 * `embedding` row in `model_config`, counting the one named by `entityId` whether or not its
 * own row has been written yet.
 *
 * This is the count that makes the silence visible. `runIndexEngine` puts it on the log line
 * it writes for every skip, so one line answers "how much of this universe is not indexed"
 * rather than only "this entity was not indexed", which on a fresh deployment is the
 * difference between a curiosity and a finding. Cheap enough to run on that path: it only
 * ever executes for a universe that has no embedding model at all, which is a state to fix
 * rather than a state to be in.
 */
export async function entitiesSkippedForNoEmbeddingModel(
	db: Db,
	universeId: string,
	entityId: string
): Promise<number> {
	const rows = await db
		.selectDistinct({ entityId: canonSaveJob.entityId })
		.from(canonSaveJob)
		.where(
			and(
				eq(canonSaveJob.universeId, universeId),
				sql`${canonSaveJob.indexOutcome}->>'status' = 'no-embedding-model'`
			)
		);
	// The current job's own row is not written yet (the outcome is recorded after every engine
	// has answered), so it is added here rather than counted: a log line that is off by one on
	// the first skip in a universe is a number nobody trusts afterwards.
	return new Set([...rows.map((row) => row.entityId), entityId]).size;
}

export interface ClaimOptions {
	leaseHolder: string;
	leaseMs: number;
	/** Reclaim attempts before a row dead-letters to `failed` instead of being handed out
	 * again - the cap that stops a job that always crashes from looping forever. */
	maxAttempts: number;
}

/** One poll: first dead-letters any claimed row whose lease has expired and whose
 * attempts are already exhausted - written to `last_error` and logged, so the failure is
 * somewhere a human can find it - then atomically claims the single most-overdue row still
 * due: pending with an elapsed `run_after`, or claimed with an expired lease and attempts
 * left. `FOR UPDATE SKIP LOCKED` is what makes two pollers calling this at once split the
 * work instead of both claiming the same row. */
export async function claimNextCanonSaveJob(
	db: Db,
	opts: ClaimOptions
): Promise<CanonSaveJobRow | null> {
	const now = new Date();

	const deadLettered = await db
		.update(canonSaveJob)
		.set({
			status: 'failed',
			lastError: sql`'lease expired after ' || ${canonSaveJob.attemptCount} || ' attempt(s); worker crashed or hung mid-run without completing it'`,
			updatedAt: now
		})
		.where(
			and(
				eq(canonSaveJob.status, 'claimed'),
				sql`${canonSaveJob.leaseExpiresAt} <= ${now.toISOString()}`,
				sql`${canonSaveJob.attemptCount} >= ${opts.maxAttempts}`
			)
		)
		.returning({
			id: canonSaveJob.id,
			universeId: canonSaveJob.universeId,
			entityId: canonSaveJob.entityId,
			attemptCount: canonSaveJob.attemptCount
		});
	for (const row of deadLettered) {
		console.error(
			JSON.stringify({
				event: 'canon_save_job_dead_lettered',
				jobId: row.id,
				universeId: row.universeId,
				entityId: row.entityId,
				attemptCount: row.attemptCount
			})
		);
	}

	const leaseExpiresAt = new Date(now.getTime() + opts.leaseMs);
	const claimable = db
		.select({ id: canonSaveJob.id })
		.from(canonSaveJob)
		.where(
			sql`(${canonSaveJob.status} = 'pending' and ${canonSaveJob.runAfter} <= ${now.toISOString()})
				or (${canonSaveJob.status} = 'claimed' and ${canonSaveJob.leaseExpiresAt} <= ${now.toISOString()})`
		)
		.orderBy(canonSaveJob.runAfter)
		.limit(1)
		.for('update', { skipLocked: true });

	const [claimed] = await db
		.update(canonSaveJob)
		.set({
			status: 'claimed',
			leaseHolder: opts.leaseHolder,
			leaseExpiresAt,
			attemptCount: sql`${canonSaveJob.attemptCount} + 1`,
			startedAt: now,
			updatedAt: now
		})
		.where(inArray(canonSaveJob.id, claimable))
		.returning();
	return claimed ?? null;
}

/** Marks a claimed row done with all three engines' outcomes - called only by the worker
 * that still holds the lease when its run actually finishes. A worker that dies before
 * this runs leaves the row `claimed` for the lease to reclaim, which is the point.
 *
 * **`finished_at` is stamped by the database and not by this process (issue #770).** Two
 * queries compare this column against a timestamp Postgres produced - the backfill sweep's
 * watermark (`enqueueDueIndexBackfills`, `j.finished_at > max(b.requested_at)`, and
 * `requested_at` defaults to `now()`) and the fan-out's "indexed since I looked" clause
 * (`scheduleBackfillIndexJobRows`) - so a `new Date()` here made both of them a comparison
 * between two clocks. Neither skew direction is catastrophic and both are avoidable for the
 * price of one word, which is cheaper than the paragraph explaining why they were tolerable.
 * `updated_at` stays a JS date: nothing compares it to anything. */
export async function completeCanonSaveJob(
	db: Db,
	id: string,
	outcome: { propagation: EngineOutcome; audit: EngineOutcome; index: IndexOutcome }
): Promise<void> {
	await db
		.update(canonSaveJob)
		.set({
			status: 'done',
			propagationOutcome: outcome.propagation,
			auditOutcome: outcome.audit,
			indexOutcome: outcome.index,
			finishedAt: sql`now()`,
			updatedAt: new Date()
		})
		.where(eq(canonSaveJob.id, id));
}

/** A row with no recorded engine outcome only happens for a dead-lettered (`failed`) job -
 * a `done` row always has one for every engine, since `completeCanonSaveJob` is the only
 * way a row becomes `done`. The fallback's shape is the 'error' branch every engine's
 * outcome type already has, so this one function backs all three rather than a copy per
 * engine. */
function deadLetterFallback(row: CanonSaveJobRow): {
	status: 'error';
	errorName: string;
	message: string;
} {
	return {
		status: 'error',
		errorName: 'CanonSaveJobLeaseExhausted',
		message: row.lastError ?? 'lease expired repeatedly; job abandoned'
	};
}

function outcomeOrDeadLetter(recorded: EngineOutcome | null, row: CanonSaveJobRow): EngineOutcome {
	return recorded ?? deadLetterFallback(row);
}

function indexOutcomeOrDeadLetter(
	recorded: IndexOutcome | null,
	row: CanonSaveJobRow
): IndexOutcome {
	return recorded ?? deadLetterFallback(row);
}

function toResult(row: CanonSaveJobRow): CanonSaveJobResult {
	return {
		universeId: row.universeId,
		entityId: row.entityId,
		entityName: row.entityName,
		startedAt: row.startedAt ?? row.createdAt,
		finishedAt: row.finishedAt ?? row.updatedAt,
		propagation: outcomeOrDeadLetter(row.propagationOutcome as EngineOutcome | null, row),
		audit: outcomeOrDeadLetter(row.auditOutcome as EngineOutcome | null, row),
		index: indexOutcomeOrDeadLetter(row.indexOutcome as IndexOutcome | null, row)
	};
}

/** Newest last, like the in-memory version this replaces. Reads `done` and `failed` rows
 * both - a dead-lettered job is exactly the kind of failure this introspection exists to
 * surface. */
export async function recentCanonSaveJobRows(db: Db, limit: number): Promise<CanonSaveJobResult[]> {
	const rows = await db
		.select()
		.from(canonSaveJob)
		.where(inArray(canonSaveJob.status, ['done', 'failed']))
		.orderBy(desc(canonSaveJob.finishedAt), desc(canonSaveJob.updatedAt))
		.limit(limit);
	return rows.reverse().map(toResult);
}

/** `id -> status` for exactly the rows asked for, not a table scan - what `waitForIdle`
 * polls to know when everything one `CanonSaveJobQueue` instance scheduled has settled,
 * safe to call while other instances (a second test file, a second replica) are writing
 * unrelated rows to the same shared table. */
export async function statusesFor(db: Db, ids: string[]): Promise<Map<string, CanonSaveJobStatus>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: canonSaveJob.id, status: canonSaveJob.status })
		.from(canonSaveJob)
		.where(inArray(canonSaveJob.id, ids));
	return new Map(rows.map((r) => [r.id, r.status]));
}
