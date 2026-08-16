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

export type EngineOutcome =
	| { status: 'ok'; planId: string }
	| { status: 'no-change' }
	| { status: 'ai-disabled' }
	| { status: 'error'; errorName: string; message: string };

/** Issue #164: the third engine's outcome, alongside `EngineOutcome` above - shaped
 * differently on purpose rather than shoehorned into it. There is no "plan" for indexing
 * to name (`ok` carries a chunk count instead), and indexing is never gated on
 * `aiEnabled` (embedding for search is reading infrastructure, not generation - see
 * `runIndexEngine`'s own doc comment), so there is no `ai-disabled` case here either.
 * `no-change` covers both "the body did not actually change" and "no embedding model is
 * configured yet", neither of which is a failure. */
export type IndexOutcome =
	| { status: 'ok'; chunkCount: number }
	| { status: 'no-change' }
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
 * this runs leaves the row `claimed` for the lease to reclaim, which is the point. */
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
			finishedAt: new Date(),
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
