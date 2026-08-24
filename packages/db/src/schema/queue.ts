// SPEC.md §5.1 and §5.2: propagation and audit run on save, debounced, in the background.
// This table is where that "in the background" becomes durable rather than a timer in one
// process's memory.
//
// The first version of the trigger kept its debounce window and its in-flight set in a Map,
// which is correct for a single container and loses a run silently on restart: nothing is
// corrupted, because the job only ever writes pending proposals, but the GM waits for
// proposals that will never arrive. A row per pending job fixes both halves. `run_after` is
// the debounce, authoritative across instances so two of them together still produce one run
// per burst, and the lease is what makes a crashed worker's job come back instead of
// evaporating.
//
// One pending row per (universe, entity) is enforced by the partial unique index, not by
// application care: that is what makes "five saves, one run" atomic, and what lets a
// follow-up land as a fresh pending row the moment the current one flips to `claimed`.
import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { entity } from './entity.js';
import { revision } from './revision.js';
import { universe } from './universe.js';
import { user } from './auth.js';

export const canonSaveJobStatusEnum = pgEnum('canon_save_job_status', [
	'pending',
	'claimed',
	'done',
	'failed'
]);

export type CanonSaveJobStatus = (typeof canonSaveJobStatusEnum.enumValues)[number];

export const canonSaveJob = pgTable(
	'canon_save_job',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		// Denormalised so a finished job still reads as something a human recognises after the
		// entity has been renamed, which is exactly the kind of save that triggers propagation.
		entityName: text('entity_name').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// The diff the run works from. Held here rather than re-derived at claim time because by
		// then the entity may have been saved again, and the run must see the burst it was
		// scheduled for.
		oldBody: text('old_body').notNull(),
		newBody: text('new_body').notNull(),
		triggerRevisionId: uuid('trigger_revision_id').references(() => revision.id, {
			onDelete: 'set null'
		}),
		// SPEC.md §17: the interface language the propagation and audit speech must come back in.
		// Stored on the row rather than resolved when the job runs, because negotiation reads a
		// cookie and an Accept-Language header that only exist during the request that scheduled
		// it: a worker picking this up ten seconds or one restart later has neither. Null means a
		// row written before this column, which the runner reads as English.
		locale: text('locale'),
		runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
		status: canonSaveJobStatusEnum('status').notNull().default('pending'),
		leaseHolder: text('lease_holder'),
		leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
		// Capped by the worker: a job that always crashes stops as `failed` with its last error
		// rather than being reclaimed forever.
		attemptCount: integer('attempt_count').notNull().default(0),
		lastError: text('last_error'),
		propagationOutcome: jsonb('propagation_outcome'),
		auditOutcome: jsonb('audit_outcome'),
		// Issue #164: the third engine a save's job runs, alongside propagation and audit -
		// chunk/extract/embed/upsert of the entity's own body into its universe's lore
		// collection. Same shape idiom as the two columns above (`IndexOutcome` in
		// `$lib/server/jobs/store.ts`), recorded independently so an embedding failure never
		// hides whether propagation or audit actually ran, and vice versa.
		indexOutcome: jsonb('index_outcome'),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('canon_save_job_pending_key')
			.on(t.universeId, t.entityId)
			.where(sql`${t.status} = 'pending'`),
		index('canon_save_job_claim_idx').on(t.status, t.runAfter),
		index('canon_save_job_lease_idx').on(t.status, t.leaseExpiresAt),
		// Finished rows are the trigger's only history, so they are kept rather than deleted on
		// completion, and something has to prune them eventually. This index is what makes that
		// prune cheap when it lands with the rest of the retention work.
		index('canon_save_job_finished_idx').on(t.finishedAt),
		// Issue #709: the backfill's trigger read. A universe whose `embedding` row went missing
		// is a state to fix rather than a state to be in, so the matching rows are a vanishing
		// fraction of this table and a partial index over the expression is the whole point: the
		// sweep asks "has any universe skipped since its last backfill" on a timer, forever, and
		// without this that question is a sequential scan of every job ever run. The `finished_at`
		// column is in the index because the sweep compares it against the watermark, so the
		// answer never leaves the index.
		index('canon_save_job_no_embedding_model_idx')
			.on(t.universeId, t.finishedAt)
			.where(sql`${t.indexOutcome}->>'status' = 'no-embedding-model'`)
	]
);

/**
 * Issue #709: one row per catch-up of a universe whose entries went unindexed while it had no
 * active `embedding` row in `model_config`.
 *
 * The gap this closes is that nothing came back. #703 made the silence visible
 * (`index_outcome = {"status":"no-embedding-model"}` plus a log line counting the universe's
 * skipped entries) and deliberately stopped there, because the honest answer to "what happens
 * when an `embedding` row appears later" was: nothing, and the universe stays out of retrieval
 * until somebody edits every entry by hand.
 *
 * **Why a table and not a flag on `universe`.** Three things need to be durable and none of
 * them is a boolean: that a catch-up is *owed* (survives the restart between the model
 * appearing and the worker noticing), that one is *already running* (so two replicas do not
 * both fan out over the same two thousand entries), and *how far it got* (so a run that dies
 * halfway is resumed rather than restarted). The partial unique index is what makes the second
 * one atomic rather than careful, exactly as `canon_save_job_pending_key` does for a save.
 *
 * The lease/attempt/dead-letter shape is deliberately the same as `canon_save_job`'s above,
 * because it is the same problem and `DurableJobPoller` is already generic over it.
 */
export const universeIndexBackfillStatusEnum = pgEnum('universe_index_backfill_status', [
	'pending',
	'claimed',
	'done',
	'failed'
]);

export type UniverseIndexBackfillStatus =
	(typeof universeIndexBackfillStatusEnum.enumValues)[number];

export const universeIndexBackfill = pgTable(
	'universe_index_backfill',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		// Why this universe is owed a catch-up. One value today ('no-embedding-model'); a text
		// column rather than an enum because the next reason to backfill (a model swap, an
		// operator asking for one) is not a schema change and should not read as one.
		reason: text('reason').notNull(),
		status: universeIndexBackfillStatusEnum('status').notNull().default('pending'),
		// The watermark the sweep compares a skipped job's `finished_at` against, so a universe
		// that skips again after a completed catch-up is enqueued again and one that does not is
		// never enqueued twice for the same skips. Set at insert and never moved.
		requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
		// A pass that scheduled its cap and has more to do requeues itself with this pushed out
		// past the run_after of the rows it just wrote, so the next pass enumerates against a
		// collection those rows have already been written into rather than re-finding them.
		runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
		leaseHolder: text('lease_holder'),
		leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
		attemptCount: integer('attempt_count').notNull().default(0),
		lastError: text('last_error'),
		// The enumeration's own answer, kept so a reader can tell "this universe had nothing
		// missing" from "this universe was never looked at": entries in the universe, entries
		// found to have no entity-level point, and index jobs actually scheduled. The last two
		// differ when a pass hits its per-pass cap, and `entities_scheduled` accumulates across
		// the passes of one backfill rather than being overwritten by the last of them.
		entitiesTotal: integer('entities_total'),
		entitiesMissing: integer('entities_missing'),
		entitiesScheduled: integer('entities_scheduled').notNull().default(0),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// "A backfill in progress cannot be started twice", enforced rather than checked: two
		// replicas sweeping at the same instant both try to insert and exactly one succeeds.
		uniqueIndex('universe_index_backfill_active_key')
			.on(t.universeId)
			.where(sql`${t.status} in ('pending', 'claimed')`),
		index('universe_index_backfill_claim_idx').on(t.status, t.runAfter),
		index('universe_index_backfill_lease_idx').on(t.status, t.leaseExpiresAt),
		// The sweep's watermark read: newest row for one universe, whatever its status.
		index('universe_index_backfill_universe_idx').on(t.universeId, t.requestedAt)
	]
);
