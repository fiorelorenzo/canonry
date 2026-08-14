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
		index('canon_save_job_finished_idx').on(t.finishedAt)
	]
);
