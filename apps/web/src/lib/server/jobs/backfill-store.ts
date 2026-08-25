/**
 * Durable storage for the index backfill of issue #709: every `universe_index_backfill` read
 * and write, and the one fan-out write into `canon_save_job` that a backfill performs.
 *
 * Same split as `store.ts`, for the same reason: the SQL lives here and `canon-save.ts` owns
 * the loop, so the queries are testable against a real database without starting a worker.
 *
 * ---
 *
 * **The invariant, and it is written here because five separate fixes have each had to
 * rediscover it.** A backfill's whole job is to make one sentence true: every indexable entity
 * in the universe has an entity-level point in its own collection. Every rule in this file and
 * in `runBackfill` is a consequence of that sentence plus two restrictions on how a pass is
 * allowed to reason towards it, and every defect this mechanism has had was one of those two
 * restrictions being broken somewhere. The first is that **only the index counts**: a backfill
 * is finished when an enumeration finds nothing missing, never when a pass has written the rows
 * it believes are enough, because a row is an intention and a point is a fact. The second is
 * that **a pass may write only what an observation it still owns justifies**: it reads the
 * queue before it reads the collection, so that anything absent from the in-flight set has
 * already made every point it ever will visible to the read that follows; it schedules only
 * what that single observation says is both missing and unclaimed; and it may not conclude
 * anything at all about a row whose lease it has lost. The rest of the lifecycle follows from
 * the two together. A pass that cannot reduce the shortfall is not making the sentence truer,
 * so it has to be bounded rather than repeated forever; the bound is about the attempt and
 * never about the universe, because a bounded attempt leaves the sentence exactly as false and
 * exactly as owed as it found it; so giving up ends a row, and the sweep, on a widening
 * cooldown, keeps the universe on the hook.
 *
 * The one-sentence version, for a reader who needs only that: **a backfill converges the
 * universe's index to its canon, concluding only from points that exist and writing only from
 * an observation it still holds, and it may give up on an attempt but never on the universe.**
 *
 * Every change this has taken restored one clause rather than adding a feature, which is the
 * evidence that the invariant and not the code is what was missing:
 *
 * - **#709/#715 built it**, and got "only the index counts" right on the second try: the first
 *   end-to-end run reported `done` from a pass that had merely *scheduled* six entries, two of
 *   which then lost their points to a Qdrant `409`, and the sweep's watermark meant nothing
 *   would ever look at that universe again. Hence `completeIndexBackfill` only on an empty
 *   enumeration.
 * - **#746** restored the second clause at write time: the fan-out's `on conflict do nothing`
 *   could not see an entity whose row had been *claimed*, because the partial unique index
 *   constrains `pending` alone, so a verification pass re-scheduled everything still draining.
 *   The anti-join inside the insert is that half.
 * - **#762** restored the bound: `resumeIndexBackfill` promised in a comment that `maxAttempts`
 *   would dead-letter a pass that got nowhere, and nothing read the attempts at all, so a
 *   universe that could not be finished re-scrolled itself every verify delay forever.
 * - **#766** restored the second clause at observation time, which is the half #746 missed: the
 *   anti-join answers for the moment of the *insert*, and the pass had decided at the *earlier*
 *   read of the collection, so a job that finished in between was invisible to both. Reading
 *   the in-flight set first, and filtering `missing` through it, is what makes the write a
 *   function of one observation. It also had to stop counting "deferred because something else
 *   is indexing it" as progress, since that reset the attempts of exactly the stuck universe
 *   the bound exists to catch.
 * - **#767** closed the same clause one actor further out: two passes over one universe overlap
 *   when a pass outlives its lease, and each then holds its own observation, so the second could
 *   write from one the first had already invalidated. The lease was this mechanism's only
 *   coordination primitive and nothing checked it where a write happens, which is also why a
 *   reclaimed pass could resume, complete or dead-letter a row a live worker owned. Every write
 *   now presents the `(lease_holder, lease_expires_at)` it was claimed under and is refused
 *   otherwise, so "an observation it still owns" is enforced rather than assumed. Which is also
 *   the short answer to why there were five: the four above are a pass acting on a stale read of
 *   the world, and this one is a pass acting on a stale read of the lease itself.
 * - **#761** is the last clause: a dead letter had no way back, so the bound was in practice a
 *   bound on the universe. `enqueueRetriesForDeadLetteredBackfills` puts the universe back on
 *   the hook on a widening cooldown.
 *
 * The reason to write this down rather than fix the sixth thing: every one of those was found
 * by a flake or by a reader noticing a comment that was not true, and each was correct in
 * isolation. A change that cannot be expressed as restoring one of these clauses is probably
 * changing what a backfill means, which is a bigger decision than it will look like in a diff.
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

/**
 * The token a pass presents with every write it makes, which is the claimed row itself: its
 * id, and the `(lease_holder, lease_expires_at)` pair the claim stamped on it.
 *
 * **Why a token and not a check (issue #767).** `claimNextIndexBackfill` hands the row to one
 * worker at a time and reclaims it when the lease expires, so the lease is this mechanism's
 * only coordination primitive - and until #767 nothing enforced it at the moment of a write.
 * A pass that hung for longer than `DEFAULT_BACKFILL_LEASE_MS` was reclaimed underneath
 * itself and then carried on: it inserted its fan-out from an observation the live pass had
 * already invalidated (a second embedding call and a second upsert for work that was
 * finished), and it called `resumeIndexBackfill` or `completeIndexBackfill` on a row another
 * worker now owned, so it could move `run_after`, zero the attempt count that #762's give-up
 * rule counts, or mark `done` a backfill still being worked on. A lease that is not checked
 * where the write happens is not a lease, it is a hint.
 *
 * So every write in this file is fenced on this triple, and the three parts each earn their
 * place. `lease_holder` alone is not enough, because a poller's holder is one
 * `randomUUID()` for the life of the instance and the same instance reclaiming its own row
 * would leave it identical; `lease_expires_at` is what always moves, since a claim sets it
 * to `now() + leaseMs` and `resumeIndexBackfill`/`completeIndexBackfill` set it to null.
 * Comparing it for equality is therefore the fencing token proper, and it costs one
 * dependency worth writing down: the claim stamps that column from a JS `Date`, at
 * millisecond precision, and the value round-trips through postgres.js unchanged. Setting it
 * from `now() + interval` in SQL instead would give it microseconds the token cannot match,
 * and the fence would start refusing the live holder. And `lease_expires_at > now()`, on the
 * database's clock rather than a worker's, is what bounds how stale a write may be: no write
 * is ever made from an observation older than one lease.
 *
 * Nullable on purpose, so that this is total rather than an assertion. A row with no lease
 * satisfies no fence: `lease_holder = null` is NULL rather than true, so a pass holding such
 * a row writes nothing, which is the answer we would want anyway.
 */
export interface BackfillLease {
	id: string;
	leaseHolder: string | null;
	leaseExpiresAt: Date | null;
}

/**
 * The predicate every write below carries, in one place: four call sites each spelling out
 * the same three clauses is four places for one of them to drift, and a fence that is right
 * in three of them is not a fence.
 *
 * Columns are deliberately unqualified. Every statement that uses this either updates
 * `universe_index_backfill` directly or selects from it under an alias, and in both cases an
 * unqualified column resolves to that table and to nothing else, so this composes with the
 * aliased `update ... as b` in `resumeIndexBackfill` and with the plain builder updates alike.
 */
function stillHeldBy(lease: BackfillLease) {
	return sql`lease_holder = ${lease.leaseHolder}
		and lease_expires_at = ${lease.leaseExpiresAt?.toISOString() ?? null}::timestamptz
		and lease_expires_at > now()`;
}

/** Why a universe is owed a catch-up. A text column rather than an enum on purpose (see the
 * table's own comment), so these are named constants rather than schema values. */
export const NO_EMBEDDING_MODEL_REASON = 'no-embedding-model';
/** #761: the sweep offering a dead-lettered universe another go once its cooldown is up. */
export const RETRY_AFTER_DEAD_LETTER_REASON = 'retry-after-dead-letter';

/**
 * The first of the sweep's two writes (`enqueueRetriesForDeadLetteredBackfills` is the other):
 * one statement that enqueues a backfill for every universe with a skipped index run more
 * recent than its last backfill request, and enqueues nothing for every other universe.
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

export interface BackfillRetryOptions {
	/** Cooldown after the first dead letter of an episode. Doubles per further dead letter. */
	baseCooldownMs: number;
	/** Ceiling the doubling stops at. */
	maxCooldownMs: number;
}

/**
 * The other half of the sweep's write, and the answer to #761: a universe whose newest backfill
 * gave up gets a fresh one once it has been left alone long enough.
 *
 * **Why this is here and not behind a button.** #745 made the `maxAttempts` cap reachable, which
 * was right, and left a universe that hit it partly unindexed with nothing that would ever look
 * at it again: `enqueueDueIndexBackfills` above only fires on a `no-embedding-model` job
 * finishing after the newest backfill's `requested_at`, and once a model is configured there are
 * no new skips. The only ways back were a hand-written `INSERT` or deactivating the `embedding`
 * row to manufacture a skip, and there is no admin surface to put a retry button on (#709). The
 * sweep, though, already runs on a timer and already asks whether any universe is owed a
 * catch-up, so it is a trigger that exists rather than one that has to be built. Nothing about
 * this needed a schema change.
 *
 * **The cooldown is the whole design, because an unbounded retry is what #745 removed.** A
 * dead letter means the shortfall did not shrink for `maxAttempts` passes running, and a retry
 * that starts immediately re-verifies the same unfixable entity and dead-letters again after
 * `maxAttempts` more, which is #745's forever-loop with extra rows in the table. So the interval
 * doubles per dead letter in the episode, from `baseCooldownMs` up to `maxCooldownMs`: a
 * transient cause (a gateway timeout, a Qdrant blip) is retried soon enough to matter, and a
 * permanent one converges on a scroll a week instead of one every verify delay. A retry is only
 * *useful* once whatever broke the entity is fixed, and since the thing that usually fixes it is
 * a deploy or a model-config change, hours is the right order of magnitude rather than seconds.
 *
 * **"Episode" rather than "ever", which is why the count is not just `count(*)`.** Failures are
 * counted from the newest `done` row forward. A universe that dead-lettered, was retried and
 * finished has had its cause fixed, so if it ever dead-letters again months later that is a new
 * problem and it starts at `baseCooldownMs` rather than inheriting a week-long interval from
 * history nobody remembers.
 *
 * The retry deliberately resets the shortfall history, because it is a new row: `attempt_count`
 * is 0 and `entities_missing` is null, so it gets a full budget and its first pass has nothing
 * to compare against. That is the point. Carrying the old numbers forward would dead-letter it
 * on its first pass and make the retry a no-op.
 *
 * Self-limiting without a watermark of its own: the row this inserts is the universe's newest,
 * and it is `pending`, so the next sweep's `distinct on` sees `pending` rather than `failed` and
 * writes nothing. `on conflict do nothing` is the same concurrency answer as above, for two
 * replicas sweeping in the same instant.
 */
export async function enqueueRetriesForDeadLetteredBackfills(
	db: Db,
	opts: BackfillRetryOptions
): Promise<string[]> {
	const baseSeconds = opts.baseCooldownMs / 1000;
	const maxSeconds = opts.maxCooldownMs / 1000;
	const rows = await db.execute<{ universe_id: string }>(sql`
		insert into ${universeIndexBackfill} (universe_id, reason)
		select e.universe_id, ${RETRY_AFTER_DEAD_LETTER_REASON}
		from (
			select distinct on (b.universe_id)
				b.universe_id,
				b.status,
				b.finished_at,
				(select count(*) from ${universeIndexBackfill} f
					where f.universe_id = b.universe_id
						and f.status = 'failed'
						and f.requested_at > coalesce(
							(select max(d.requested_at) from ${universeIndexBackfill} d
								where d.universe_id = b.universe_id and d.status = 'done'),
							'-infinity'::timestamptz)) as episode_failures
			from ${universeIndexBackfill} b
			order by b.universe_id, b.requested_at desc
		) e
		where e.status = 'failed'
			and e.finished_at is not null
			and e.finished_at + make_interval(secs => least(
				${baseSeconds}::double precision * power(2, e.episode_failures - 1),
				${maxSeconds}::double precision)) <= now()
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

export interface BackfillFanOutResult {
	/** How many job rows this pass actually wrote. */
	inserted: number;
	/** True when the insert was refused because this pass no longer holds the lease, which is
	 * a different fact from `inserted === 0` and the caller has to be able to tell them apart:
	 * zero inserted is a pass that found everything already in flight and should carry on to
	 * record its numbers, fenced is a pass that must record nothing at all. */
	fenced: boolean;
}

/**
 * Which entities of this universe already have an index job in flight, read as one set so
 * that a pass can fix its work list at the moment it looks rather than at the moment it
 * writes (issue #764).
 *
 * **Why the caller needs this at all, when the fan-out below already anti-joins on the same
 * two states.** That anti-join runs inside the insert, and the insert is not where the pass
 * decided anything. The decision is the enumeration: "this entry has no point in the
 * collection", which is a read of Qdrant taken some milliseconds earlier. In between, the
 * job that was going to write that point can finish, and then the anti-join sees a `done`
 * row, which is deliberately *not* in-flight (#715: an entry whose job ended without writing
 * its point still needs one) and which `canon_save_job_pending_key` does not constrain
 * either, so the pass schedules a second job for work that has already been done. Measured
 * rather than argued about: `canon-save.test.ts`'s #764 case forces exactly that ordering
 * and gets two rows for one entity out of it.
 *
 * So the pass reads this set **before** it reads the collection, and that order is the whole
 * guarantee rather than a detail. `upsertPoints` writes with `wait: true` and
 * `completeCanonSaveJob` runs after it, so a job that is not in this set has already made
 * every point it is ever going to make visible to any read taken later - which the
 * collection read, taken later, therefore accounts for. An entity in the set is skipped this
 * pass and re-examined by the next one, which costs nothing: a backfill is only terminal on
 * an empty enumeration (#715), and one that never converges is dead-lettered with a
 * `last_error` rather than left looping (#762).
 */
export async function entitiesWithIndexJobInFlight(
	db: Db,
	universeId: string
): Promise<Set<string>> {
	const rows = await db
		.selectDistinct({ entityId: canonSaveJob.entityId })
		.from(canonSaveJob)
		.where(
			and(
				eq(canonSaveJob.universeId, universeId),
				inArray(canonSaveJob.status, ['pending', 'claimed'])
			)
		);
	return new Set(rows.map((row) => row.entityId));
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
 * **What this statement cannot see on its own, which is issue #764.** The anti-join covers
 * every entity that is in flight *now*, and "now" is the insert rather than the enumeration
 * that decided what to insert. An entity in flight when the caller read the collection and
 * finished by the time the caller got here is invisible to both mechanisms: `done` is not in
 * the anti-join's states by design, and the partial index constrains `pending` alone. So the
 * dedupe is in two halves and both are load-bearing. The caller owns the observation-time
 * half (`entitiesWithIndexJobInFlight`, read before the collection), which covers a job that
 * left the in-flight set; this statement owns the write-time half, which covers a job that
 * joined it - a GM saving that entry, or a second replica's pass - because a set read a
 * moment ago cannot know about those.
 *
 * **And the third half, which is issue #767.** Both of the above are about the entity's index
 * state, and neither is about who is entitled to act on it. Two passes over one universe each
 * hold their own observation, so the second can write from one the first has already
 * invalidated: a `done` row is not in-flight and is not constrained by the partial index, so
 * the two mechanisms above see nothing wrong with it. What excludes it is that only one pass
 * holds the lease, which is what `held` below checks and what `BackfillLease` is for. It is
 * checked inside this statement rather than before it, and with `for update`, because the
 * claim path takes the same row `for update skip locked`: while this insert holds that lock
 * the row cannot be reclaimed, and once it is reclaimed this insert cannot fire. The lock is
 * held for one insert rather than for a pass, which is the whole reason this is cheaper than
 * serialising the passes.
 *
 * Bodies are empty for the same structural reason `EntityIndexJobInput` has no body fields: an
 * empty `semanticDiff` is what makes propagation and audit no-ops without a flag, so a
 * backfill cannot make the copilot write anything. `trigger_revision_id` is null, and
 * `user_id` is the universe's owner, read in the same statement: there is no actor behind a
 * backfill, and the owner is who a zero-credit `index.embed` call in their world belongs to.
 */
export async function scheduleBackfillIndexJobRows(
	db: Db,
	lease: BackfillLease,
	universeId: string,
	locale: Locale,
	rows: readonly BackfillIndexJobRow[]
): Promise<BackfillFanOutResult> {
	if (rows.length === 0) return { inserted: 0, fenced: false };
	const values = rows.map(
		(row) =>
			sql`(${universeId}::uuid, ${row.entityId}::uuid, ${row.entityName}, ${locale},
				now() + make_interval(secs => ${row.delayMs / 1000}))`
	);
	// One statement, so that "am I still the holder" and "insert these rows" cannot be
	// separated by anything. `held` is scanned because the insert's own `exists` needs it, and
	// a `for update` CTE is never inlined, so it is evaluated exactly once and the count the
	// outer select reads is the same evaluation the insert was gated on.
	const [result] = await db.execute<{ lease_held: number; inserted: number }>(sql`
		with held as (
			select id from ${universeIndexBackfill}
			where id = ${lease.id}::uuid and ${stillHeldBy(lease)}
			for update
		), fanned_out as (
			insert into ${canonSaveJob}
				(universe_id, entity_id, entity_name, user_id, old_body, new_body, trigger_revision_id,
					locale, run_after)
			select v.universe_id, v.entity_id, v.entity_name, u.owner_user_id, '', '', null,
				v.locale, v.run_after
			from (values ${sql.join(values, sql`, `)})
				as v(universe_id, entity_id, entity_name, locale, run_after)
			join ${universe} u on u.id = v.universe_id
			where exists (select 1 from held)
				and not exists (
					select 1 from ${canonSaveJob} inflight
					where inflight.universe_id = v.universe_id
						and inflight.entity_id = v.entity_id
						and inflight.status in ('pending', 'claimed')
				)
			on conflict do nothing
			returning id
		)
		select (select count(*) from held)::int as lease_held,
			(select count(*) from fanned_out)::int as inserted
	`);
	return {
		inserted: Number(result?.inserted ?? 0),
		fenced: Number(result?.lease_held ?? 0) === 0
	};
}

/** A pass that scheduled everything it found. Terminal: the unique index stops holding the
 * universe, so a later skip can enqueue a fresh backfill.
 *
 * Fenced on the lease (#767), and this is the write where a reclaimed pass did the most
 * damage: it marked `done` a backfill a live worker was still working on, which released the
 * partial unique index and set `finished_at` from a pass that had no business finishing
 * anything. Answers false when the write was refused for that reason. */
export async function completeIndexBackfill(
	db: Db,
	lease: BackfillLease,
	counts: { entitiesTotal: number; entitiesMissing: number; scheduled: number }
): Promise<boolean> {
	const now = new Date();
	const applied = await db
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
		.where(and(eq(universeIndexBackfill.id, lease.id), stillHeldBy(lease)))
		.returning({ id: universeIndexBackfill.id });
	return applied.length > 0;
}

/** What one resumed pass did to the row, so the caller can log a dead-letter at `error`
 * without reading the row back. */
export interface ResumeIndexBackfillResult {
	/** False when the write was refused because this pass no longer holds the lease (#767), in
	 * which case the other two fields describe nothing and the pass must stop. */
	applied: boolean;
	/** True when this pass ended the backfill instead of queueing another one. */
	deadLettered: boolean;
	/** The attempt count the decision was taken on. */
	attemptCount: number;
}

/**
 * Back to `pending`, due once the rows this pass wrote have drained, with `entities_scheduled`
 * accumulated rather than replaced. A backfill is not terminal until an enumeration comes back
 * empty, so this is the ordinary end of a pass and `completeIndexBackfill` is the exception.
 *
 * **This is also the only place a backfill that is getting nowhere can be stopped, and #745 is
 * why it says so here.** `claimNextIndexBackfill` checks `maxAttempts` in exactly one place,
 * the dead-letter update, and that update is gated on `status = 'claimed' and
 * lease_expires_at <= now()`. A pass that finishes cleanly comes back through this function,
 * which sets `pending` and clears the lease, so the row is never in the state the cap is
 * checked in. Only a pass that throws (`requeueIndexBackfill`) could ever be dead-lettered.
 * This comment used to promise that "the `maxAttempts` cap eventually dead-letters it", and
 * for as long as it did, nothing read the attempts at all: #737 watched one reach 69 in about
 * thirteen seconds. So the cap is consulted here now, and the promise is kept rather than
 * dropped, because the alternative is a universe that cannot be finished re-scrolling itself
 * every verify delay for the life of the deployment.
 *
 * **What counts as progress, which is what makes the cap both reachable and safe.** The
 * counter has to mean "consecutive passes that got nowhere", or the bound punishes a slow
 * universe instead of a stuck one. Two things count as getting somewhere:
 *
 * - `capped`: the pass hit `BACKFILL_MAX_PER_PASS` and there is different work waiting, so
 *   the next pass is not a repeat. This was the only signal before, and on its own it is not
 *   enough: a universe under the cap whose index jobs simply drain more slowly than one
 *   verify delay produces no capped pass at all, and would have burnt its attempts while
 *   perfectly healthy.
 * - `entities_missing` fell since the pass before. Points are landing, the queue is draining,
 *   and the backfill is working even though it is not finished. Measured against the value
 *   this same statement is about to overwrite, so it is the previous pass's number.
 *
 * Either resets the attempts to zero. Neither, `maxAttempts` times running, is a backfill
 * that has verified the same shortfall over and over, which is the entity whose embedding
 * fails every time from #745's own body: the job row reaches `done`, the point never appears,
 * and no number of further passes will change that.
 *
 * **Giving up ends this row, and it is no longer the end of the universe (#761).** The row goes
 * `failed` with `finished_at` and a `last_error` naming the attempts and the shortfall, which
 * is what `recentIndexBackfills` reads and the caller logs at `error`. It also releases the
 * partial unique index, and this used to be as far as it went: the only other way in was a
 * `no-embedding-model` job finishing after this row's `requested_at` watermark, and once a
 * model is configured there are no new skips, so a dead-lettered universe stayed unindexed
 * until somebody wrote an `INSERT` by hand. `enqueueRetriesForDeadLetteredBackfills` closes
 * that: the sweep gives this universe a fresh row once the cooldown on its episode has
 * elapsed, doubling per dead letter, so the shape is "give up on this attempt" rather than
 * either "give up on the world" or #745's unbounded poll. What is still true is that nothing
 * *shows* it to a GM, only the log and this table (#709 is still the surface that does not
 * exist), and that a retry is only useful once whatever broke the entity is fixed: it will
 * dead-letter again after `maxAttempts` passes otherwise, on a longer cooldown each time.
 *
 * The original note on the second case is still the reason any of this is careful. The first
 * end-to-end run of this backfill lost two of six entries to a Qdrant `409 Conflict` from
 * concurrent `ensureCollection` calls (fixed in `@canonry/vector` in the same change), and
 * the pass that scheduled them had already reported `done`: the watermark then meant no later
 * sweep would ever look at that universe again, so two entries were out of retrieval
 * permanently. A catch-up that declares success on "scheduled" rather than on "indexed"
 * reintroduces the exact bug it exists to fix.
 */
export async function resumeIndexBackfill(
	db: Db,
	lease: BackfillLease,
	counts: {
		entitiesTotal: number;
		entitiesMissing: number;
		scheduled: number;
		nextRunAfterMs: number;
		/** This pass hit its per-pass cap, so the next one has different work to do. */
		capped: boolean;
		maxAttempts: number;
	}
): Promise<ResumeIndexBackfillResult> {
	const now = new Date();
	const runAfter = new Date(now.getTime() + counts.nextRunAfterMs);
	// One statement, so the decision is taken against the row's own previous numbers rather
	// than a value read a moment earlier: `d` is evaluated on the pre-update snapshot, which is
	// what makes "fewer missing than last time" mean the last pass and not this one.
	const rows = await db.execute<{ status: UniverseIndexBackfillStatus; attempt_count: number }>(
		sql`
			update ${universeIndexBackfill} as b set
				status = (case when d.giving_up then 'failed' else 'pending' end)::universe_index_backfill_status,
				entities_total = ${counts.entitiesTotal},
				entities_missing = ${counts.entitiesMissing},
				entities_scheduled = b.entities_scheduled + ${counts.scheduled},
				attempt_count = case when d.progressed then 0 else b.attempt_count end,
				lease_holder = null,
				lease_expires_at = null,
				run_after = case
					when d.giving_up then b.run_after
					else ${runAfter.toISOString()}::timestamptz end,
				finished_at = case
					when d.giving_up then ${now.toISOString()}::timestamptz
					else b.finished_at end,
				last_error = case
					when d.giving_up then 'gave up after ' || b.attempt_count
						|| ' pass(es) that reduced nothing: ' || ${counts.entitiesMissing}
						|| ' entity/entities still have no index point'
					else b.last_error end,
				updated_at = ${now.toISOString()}::timestamptz
			from (
				select
					p.progressed,
					(not p.progressed and p.attempt_count >= ${counts.maxAttempts}) as giving_up
				from (
					select
						attempt_count,
						(${counts.capped}::boolean
							or entities_missing is null
							or ${counts.entitiesMissing} < entities_missing) as progressed
					from ${universeIndexBackfill}
					where id = ${lease.id}
				) p
			) d
			where b.id = ${lease.id} and ${stillHeldBy(lease)}
			returning b.status, b.attempt_count
		`
	);
	const row = rows[0];
	return {
		applied: row !== undefined,
		deadLettered: row?.status === 'failed',
		attemptCount: Number(row?.attempt_count ?? 0)
	};
}

/**
 * A pass that threw: left `claimed` with its lease expiring shortly, which is what the claim
 * above already knows how to reclaim, and its error recorded where a human can read it.
 *
 * Deliberately not a status of its own. Reusing the lease is what makes the attempt cap and
 * the dead-letter path apply to a thrown error for free, and it keeps a failing backfill
 * retrying on the order of seconds instead of the ten minutes a real lease runs for.
 *
 * Fenced like the rest (#767), and the one place where the fence costs something worth naming:
 * a pass reclaimed while it was failing cannot record its own message, so the row keeps the
 * claim path's `lease expired after N attempt(s)` instead. That is the honest version of
 * events - the row belongs to somebody else and its story is theirs - and the message is not
 * lost, because `universe_index_backfill_failed` is logged before this is called. The
 * alternative, fencing on identity alone so that a stale-but-unreclaimed pass could still
 * write, would buy that one string at the cost of the "no write from an observation older than
 * one lease" clause, which is worth more.
 */
export async function requeueIndexBackfill(
	db: Db,
	lease: BackfillLease,
	failure: { message: string; retryMs: number }
): Promise<boolean> {
	const now = new Date();
	const applied = await db
		.update(universeIndexBackfill)
		.set({
			lastError: failure.message,
			leaseExpiresAt: new Date(now.getTime() + failure.retryMs),
			updatedAt: now
		})
		.where(and(eq(universeIndexBackfill.id, lease.id), stillHeldBy(lease)))
		.returning({ id: universeIndexBackfill.id });
	return applied.length > 0;
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
