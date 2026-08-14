// SPEC.md §4.5 and §8. Two tables that only exist because nothing the GM sees at the table
// may wait on a model: `session_context` is what the GM declared ("they have entered
// Valdoria"), and `warm_artifact` is the material computed before it was asked for.
import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { entity } from './entity.js';
import { warmArtifactKindEnum } from './enums.js';
import { universe } from './universe.js';

// The anchor for everything table mode does: what §8 reads to decide what to pin and what
// to warm next, and what a revelation created during play attaches to.
export const sessionContext = pgTable(
	'session_context',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		// Where the party is. Declared by the GM, never inferred: decision E1 rejected
		// inferring it from overheard dialogue, because that needs a model and cannot be
		// bounded under the instant lane's 100 ms.
		placeEntityId: uuid('place_entity_id').references(() => entity.id, { onDelete: 'set null' }),
		// A session is an entity of type 'session'.
		sessionEntityId: uuid('session_entity_id').references(() => entity.id, {
			onDelete: 'set null'
		}),
		moment: text('moment').notNull().default(''),
		situation: text('situation').notNull().default(''),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		endedAt: timestamp('ended_at', { withTimezone: true })
	},
	(t) => [
		index('session_context_universe_started_idx').on(t.universeId, t.startedAt),
		// One running context per universe. A second one is a bug, not a feature, since
		// table mode pins from exactly one place at a time.
		uniqueIndex('session_context_running_key')
			.on(t.universeId)
			.where(sql`ended_at is null`)
	]
);

// SPEC.md §4.5 and §8.1: pre-computed material with the fingerprint of its sources, what it
// cost, and how often it was consumed. The fingerprint is what makes invalidation lazy:
// stale marks an artifact for the next trigger rather than regenerating it now, because an
// hour of editing a faction would otherwise cascade into forty regenerations.
//
// The consumption counter is not bookkeeping: SPEC.md §14 makes warm hit rate, consumed
// over generated, the metric that governs the warm radius.
export const warmArtifact = pgTable(
	'warm_artifact',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		kind: warmArtifactKindEnum('kind').notNull(),
		// What it is about. Null for a context pack that spans a ring rather than an entry.
		subjectEntityId: uuid('subject_entity_id').references(() => entity.id, {
			onDelete: 'cascade'
		}),
		payload: jsonb('payload').notNull(),
		// entity revision ids + prompt version + model id, hashed. Same fingerprint means
		// the artifact is still valid; a different one means stale.
		fingerprint: text('fingerprint').notNull(),
		stale: boolean('stale').notNull().default(false),
		credits: numeric('credits', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
		consumedCount: integer('consumed_count').notNull().default(0),
		lastConsumedAt: timestamp('last_consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('warm_artifact_lookup_idx').on(t.universeId, t.kind, t.subjectEntityId),
		uniqueIndex('warm_artifact_fingerprint_key').on(t.kind, t.subjectEntityId, t.fingerprint)
	]
);
