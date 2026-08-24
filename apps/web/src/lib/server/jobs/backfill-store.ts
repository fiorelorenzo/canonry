/**
 * Durable storage for the index backfill of issue #709: every `universe_index_backfill` read
 * and write, and the one fan-out write into `canon_save_job` that a backfill performs.
 *
 * Same split as `store.ts`, for the same reason: the SQL lives here and `canon-save.ts` owns
 * the loop, so the queries are testable against a real database without starting a worker.
 */
import { and, desc, eq, inArray, sql, type Db } from '@canonry/db';
import {
	canonSaveJob,
	universe,
	universeIndexBackfill,
	type UniverseIndexBackfillStatus
} from '@canonry/db/schema';
import type { Locale } from '@canonry/lang';

export type UniverseIndexBackfillRow = typeof universeIndexBackfill.$inferSelect;

/** The only reason a backfill is owed today. A text column rather than an enum on purpose
 * (see the table's own comment), so this is a named constant rather than a schema value. */
export const NO_EMBEDDING_MODEL_REASON = 'no-embedding-model';

/**
 * The sweep's whole write: one statement that enqueues a backfill for every universe with a
 * skipped index run more recent than its last backfill request, and enqueues nothing for
 * every other universe.
 *
 * **The watermark is what stops this looping.** `requested_at` on the newest backfill row for
 * a universe is the line: a skipped job that finished before it is already accounted for by
 * that backfill, whose enumeration ran afterwards and therefore saw the entry. A skipped job
 * that finished after it is new evidence, and the only way to produce one once a model is
 * configured is for the row to be deactivated again, which is exactly when a second catch-up
 * is wanted. Without the watermark the same historical skips would re-enqueue a backfill
 * every sweep, forever.
 *
 * `on conflict do nothing` is the concurrency answer rather than a check-then-insert: the
 * partial unique index on `(universe_id) where status in ('pending','claimed')` means two
 * replicas sweeping in the same instant produce one row, and a universe whose previous
 * backfill has not finished yet is not enqueued twice.
 *
 * Reads `canon_save_job` through the partial index added with this table, so the cost on a
 * deployment that has never skipped (which is every one we run) is an empty index scan.
 */
export async function enqueueDueIndexBackfills(db: Db): Promise<string[]> {
	const rows = await db.execute<{ universe_id: string }>(sql`
		insert into ${universeIndexBackfill} (universe_id, reason)
		select j.universe_id, ${NO_EMBEDDING_MODEL_REASON}
		from ${canonSaveJob} j
		where j.index_outcome->>'status' = ${NO_EMBEDDING_MODEL_REASON}
			and j.finished_at > coalesce(
				(select max(b.requested_at) from ${universeIndexBackfill} b
					where b.universe_id = j.universe_id),
				'-infinity'::timestamptz)
		group by j.universe_id
		on conflict do nothing
		returning universe_id
	`);
	return rows.map((row) => row.universe_id);
}

export interface BackfillClaimOptions {
	leaseHolder: string;
	leaseMs: number;
	maxAttempts: number;
}

/**
 * One poll of the backfill queue, the same shape as `claimNextCanonSaveJob`: dead-letter any
 * claimed row whose lease has expired with its attempts already spent, then atomically claim
 * the single oldest row that is due.
 *
 * A dead-lettered backfill is a universe that stays unindexed, so it is logged at `error`
 * rather than left for somebody to notice in the table.
 */
export async function claimNextIndexBackfill(
	db: Db,
	opts: BackfillClaimOptions
): Promise<UniverseIndexBackfillRow | null> {
	const now = new Date();

	const deadLettered = await db
		.update(universeIndexBackfill)
		.set({
			status: 'failed',
			lastError: sql`coalesce(${universeIndexBackfill.lastError} || ' | ', '') || 'lease expired after ' || ${universeIndexBackfill.attemptCount} || ' attempt(s)'`,
			finishedAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(universeIndexBackfill.status, 'claimed'),
				sql`${universeIndexBackfill.leaseExpiresAt} <= ${now.toISOString()}`,
				sql`${universeIndexBackfill.attemptCount} >= ${opts.maxAttempts}`
			)
		)
		.returning({
			id: universeIndexBackfill.id,
			universeId: universeIndexBackfill.universeId,
			attemptCount: universeIndexBackfill.attemptCount,
			lastError: universeIndexBackfill.lastError
		});
	for (const row of deadLettered) {
		console.error(
			JSON.stringify({
				event: 'universe_index_backfill_dead_lettered',
				backfillId: row.id,
				universeId: row.universeId,
				attemptCount: row.attemptCount,
				lastError: row.lastError
			})
		);
	}

	const leaseExpiresAt = new Date(now.getTime() + opts.leaseMs);
	const claimable = db
		.select({ id: universeIndexBackfill.id })
		.from(universeIndexBackfill)
		.where(
			sql`(${universeIndexBackfill.status} = 'pending' and ${universeIndexBackfill.runAfter} <= ${now.toISOString()})
				or (${universeIndexBackfill.status} = 'claimed' and ${universeIndexBackfill.leaseExpiresAt} <= ${now.toISOString()})`
		)
		.orderBy(universeIndexBackfill.runAfter)
		.limit(1)
		.for('update', { skipLocked: true });

	const [claimed] = await db
		.update(universeIndexBackfill)
		.set({
			status: 'claimed',
			leaseHolder: opts.leaseHolder,
			leaseExpiresAt,
			attemptCount: sql`${universeIndexBackfill.attemptCount} + 1`,
			startedAt: sql`coalesce(${universeIndexBackfill.startedAt}, ${now.toISOString()})`,
			updatedAt: now
		})
		.where(inArray(universeIndexBackfill.id, claimable))
		.returning();
	return claimed ?? null;
}

export interface BackfillIndexJobRow {
	entityId: string;
	entityName: string;
	/** Milliseconds from now that this row becomes due - the stagger that bounds the fan-out
	 * (see `canon-save.ts`'s `BACKFILL_*` constants). */
	delayMs: number;
}

/**
 * The fan-out: one index-only `canon_save_job` row per missing entity, due at a staggered
 * time, in one statement.
 *
 * **`on conflict do nothing`, where `scheduleEntityIndexJobRow` does `on conflict do update`,
 * and the difference matters.** That function's conflict branch moves `run_after`, which is
 * right for a fresh accept (the debounce window should measure from the last write) and wrong
 * here: a backfill row staggered four hundred seconds out would push a GM's pending save four
 * hundred seconds out with it, and that save's propagation is the one thing this table exists
 * to deliver on time. A pending row for this entity already indexes it - the worker runs the
 * index engine for every job, not only for one that asked - so doing nothing is both the safe
 * answer and the correct one.
 *
 * **The conflict clause alone does not say that, though, which is issue #737.**
 * `canon_save_job_pending_key` is unique on `(universe_id, entity_id)` *where status =
 * 'pending'* and nothing more, so the moment a worker claims a row that row stops blocking an
 * insert for the same entity. A verification pass that re-enumerates while the fan-out it just
 * wrote is still draining therefore schedules every in-flight entity a second time: a second
 * embedding call and a second upsert for work already under way. Measured rather than reasoned
 * about - three entries against a slow embedder came out as three duplicated rows and an
 * `entities_scheduled` of 6 - and it is what made this file's own count assertions flake under
 * load. So the anti-join below is the real dedupe and the conflict clause is the atomic
 * backstop behind it. It is cheap: both `canon_save_job` claim indexes lead with `status`, so
 * the in-flight set is an index scan rather than a lookup per candidate row.
 *
 * A row that has genuinely stopped (`done`, or dead-lettered `failed`) is deliberately not
 * in-flight, because an entry whose job ended without writing its point still needs one.
 *
 * Bodies are empty for the same structural reason `EntityIndexJobInput` has no body fields: an
 * empty `semanticDiff` is what makes propagation and audit no-ops without a flag, so a
 * backfill cannot make the copilot write anything. `trigger_revision_id` is null, and
 * `user_id` is the universe's owner, read in the same statement: there is no actor behind a
 * backfill, and the owner is who a zero-credit `index.embed` call in their world belongs to.
 */
export async function scheduleBackfillIndexJobRows(
	db: Db,
	universeId: string,
	locale: Locale,
	rows: readonly BackfillIndexJobRow[]
): Promise<number> {
	if (rows.length === 0) return 0;
	const values = rows.map(
		(row) =>
			sql`(${universeId}::uuid, ${row.entityId}::uuid, ${row.entityName}, ${locale},
				now() + make_interval(secs => ${row.delayMs / 1000}))`
	);
	const inserted = await db.execute<{ id: string }>(sql`
		insert into ${canonSaveJob}
			(universe_id, entity_id, entity_name, user_id, old_body, new_body, trigger_revision_id,
				locale, run_after)
		select v.universe_id, v.entity_id, v.entity_name, u.owner_user_id, '', '', null,
			v.locale, v.run_after
		from (values ${sql.join(values, sql`, `)})
			as v(universe_id, entity_id, entity_name, locale, run_after)
		join ${universe} u on u.id = v.universe_id
		where not exists (
			select 1 from ${canonSaveJob} inflight
			where inflight.universe_id = v.universe_id
				and inflight.entity_id = v.entity_id
				and inflight.status in ('pending', 'claimed')
		)
		on conflict do nothing
		returning id
	`);
	return inserted.length;
}

/** A pass that scheduled everything it found. Terminal: the unique index stops holding the
 * universe, so a later skip can enqueue a fresh backfill. */
export async function completeIndexBackfill(
	db: Db,
	id: string,
	counts: { entitiesTotal: number; entitiesMissing: number; scheduled: number }
): Promise<void> {
	const now = new Date();
	await db
		.update(universeIndexBackfill)
		.set({
			status: 'done',
			entitiesTotal: counts.entitiesTotal,
			entitiesMissing: counts.entitiesMissing,
			entitiesScheduled: sql`${universeIndexBackfill.entitiesScheduled} + ${counts.scheduled}`,
			leaseHolder: null,
			leaseExpiresAt: null,
			finishedAt: now,
			updatedAt: now
		})
		.where(eq(universeIndexBackfill.id, id));
}

/**
 * Back to `pending`, due once the rows this pass wrote have drained, with `entities_scheduled`
 * accumulated rather than replaced. A backfill is not terminal until an enumeration comes back
 * empty, so this is the ordinary end of a pass and `completeIndexBackfill` is the exception.
 *
 * **`resetAttempts` is what makes this terminate, and it is the difference between the two
 * reasons a pass comes back.** A pass that hit its per-pass cap made real progress and the next
 * pass has different work to do, so its attempts go back to zero: leaving them climbing would
 * dead-letter a large universe's catch-up on its fifth healthy pass. A pass that scheduled
 * everything it found and is only coming back to check that the queue actually landed it has
 * made no progress by definition if it finds the same entries missing again, so its attempts
 * climb and the `maxAttempts` cap eventually dead-letters it with its last error visible.
 *
 * That second case is not hypothetical. The first end-to-end run of this backfill lost two of
 * six entries to a Qdrant `409 Conflict` from concurrent `ensureCollection` calls (fixed in
 * `@canonry/vector` in the same change), and the pass that scheduled them had already reported
 * `done`: the watermark then meant no later sweep would ever look at that universe again, so
 * two entries were out of retrieval permanently. A catch-up that declares success on
 * "scheduled" rather than on "indexed" reintroduces the exact bug it exists to fix.
 */
export async function resumeIndexBackfill(
	db: Db,
	id: string,
	counts: {
		entitiesTotal: number;
		entitiesMissing: number;
		scheduled: number;
		nextRunAfterMs: number;
		resetAttempts: boolean;
	}
): Promise<void> {
	const now = new Date();
	await db
		.update(universeIndexBackfill)
		.set({
			status: 'pending',
			entitiesTotal: counts.entitiesTotal,
			entitiesMissing: counts.entitiesMissing,
			entitiesScheduled: sql`${universeIndexBackfill.entitiesScheduled} + ${counts.scheduled}`,
			...(counts.resetAttempts ? { attemptCount: 0 } : {}),
			leaseHolder: null,
			leaseExpiresAt: null,
			runAfter: new Date(now.getTime() + counts.nextRunAfterMs),
			updatedAt: now
		})
		.where(eq(universeIndexBackfill.id, id));
}

/**
 * A pass that threw: left `claimed` with its lease expiring shortly, which is what the claim
 * above already knows how to reclaim, and its error recorded where a human can read it.
 *
 * Deliberately not a status of its own. Reusing the lease is what makes the attempt cap and
 * the dead-letter path apply to a thrown error for free, and it keeps a failing backfill
 * retrying on the order of seconds instead of the ten minutes a real lease runs for.
 */
export async function requeueIndexBackfill(
	db: Db,
	id: string,
	failure: { message: string; retryMs: number }
): Promise<void> {
	const now = new Date();
	await db
		.update(universeIndexBackfill)
		.set({
			lastError: failure.message,
			leaseExpiresAt: new Date(now.getTime() + failure.retryMs),
			updatedAt: now
		})
		.where(eq(universeIndexBackfill.id, id));
}

/** Newest first. Introspection for the tests and for whoever is looking at why a universe is
 * or is not indexed; nothing in the product reads it yet. */
export async function recentIndexBackfills(
	db: Db,
	limit: number,
	universeId?: string
): Promise<UniverseIndexBackfillRow[]> {
	const where = universeId ? eq(universeIndexBackfill.universeId, universeId) : undefined;
	return db
		.select()
		.from(universeIndexBackfill)
		.where(where)
		.orderBy(desc(universeIndexBackfill.requestedAt))
		.limit(limit);
}

export type { UniverseIndexBackfillStatus };
