// SPEC.md §4.4 and §10. `revelation` is what the players have discovered and in which
// session, and the players' wiki is a **join** on it rather than a per-entry flag somebody
// has to remember to flip. That is the whole design: if it came up at the table, it shows
// up, with no curation step to forget.
//
// Guardrail 6 is enforced by the absence of a row. Nothing is visible to players because
// an entry says so; it is visible because a revelation exists for it. Decision E5 chose
// the session log confirmed after the table breaks, with a live tap during play, and
// decision E7 chose to render an undiscovered entry as an honest gap page.
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { entity } from './entity.js';
import { revelationKindEnum } from './enums.js';
import { fact } from './fact.js';
import { relation } from './relation.js';
import { universe } from './universe.js';

export const revelation = pgTable(
	'revelation',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		kind: revelationKindEnum('kind').notNull(),
		// Exactly one of these three is set, which the check constraint below enforces.
		entityId: uuid('entity_id').references(() => entity.id, { onDelete: 'cascade' }),
		factId: uuid('fact_id').references(() => fact.id, { onDelete: 'cascade' }),
		relationId: uuid('relation_id').references(() => relation.id, { onDelete: 'cascade' }),
		// Which session it came up in. A session is an entity of type 'session' (SPEC.md
		// §4.2 lists session among the six types), so this points at the entity table
		// rather than inventing a parallel notion of a session.
		sessionEntityId: uuid('session_entity_id').references(() => entity.id, {
			onDelete: 'set null'
		}),
		// Decision E5: a live tap during play publishes immediately, the session log is
		// confirmed afterwards. This records which path a row came from, because the
		// difference matters when a GM asks why the party knows something.
		confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
		confirmedBy: text('confirmed_by').references(() => user.id, { onDelete: 'set null' }),
		note: text('note').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('revelation_universe_idx').on(t.universeId, t.createdAt),
		index('revelation_session_idx').on(t.sessionEntityId),
		// Revealing the same thing twice in the same session is a no-op, not two rows.
		uniqueIndex('revelation_entity_session_key').on(t.entityId, t.sessionEntityId),
		uniqueIndex('revelation_fact_session_key').on(t.factId, t.sessionEntityId),
		uniqueIndex('revelation_relation_session_key').on(t.relationId, t.sessionEntityId)
	]
);
