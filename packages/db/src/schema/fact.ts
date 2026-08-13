import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authorKindEnum } from './enums.js';
import { entity } from './entity.js';
import { revision } from './revision.js';
import { universe } from './universe.js';

// SPEC.md §4.2: "an atomic statement extracted from an entry, carrying the span of the
// source text." The span is character offsets into `source_revision_id`'s `body`.
export const fact = pgTable(
	'fact',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		statement: text('statement').notNull(),
		sourceRevisionId: uuid('source_revision_id')
			.notNull()
			.references(() => revision.id, { onDelete: 'cascade' }),
		spanStart: integer('span_start').notNull(),
		spanEnd: integer('span_end').notNull(),
		authorKind: authorKindEnum('author_kind').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [check('fact_span_valid', sql`${t.spanEnd} > ${t.spanStart}`)]
);
