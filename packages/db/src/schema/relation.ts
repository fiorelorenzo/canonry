import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authorKindEnum, entityTypeEnum, relationCardinalityEnum } from './enums.js';
import { entity } from './entity.js';
import { universe } from './universe.js';

// SPEC.md §4.2 catalogue: label, inverse label, cardinality, allowed types at each end.
// `universe_id` null means the shipped catalogue; a row means a universe's own type.
export const relationType = pgTable(
	'relation_type',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		inverseLabel: text('inverse_label').notNull(),
		cardinality: relationCardinalityEnum('cardinality').notNull(),
		allowedFrom: entityTypeEnum('allowed_from').array().notNull(),
		allowedTo: entityTypeEnum('allowed_to').array().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('relation_type_universe_label_key').on(t.universeId, t.label).nullsNotDistinct()]
);

// SPEC.md §4.2: "one row between two entities. The opposite entry renders the inverse
// label from relation_type. One row, never two, so the two sides cannot drift apart."
export const relation = pgTable(
	'relation',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		relationTypeId: uuid('relation_type_id')
			.notNull()
			.references(() => relationType.id),
		fromEntityId: uuid('from_entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		toEntityId: uuid('to_entity_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		authorKind: authorKindEnum('author_kind').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// One row per relationship, never two.
		uniqueIndex('relation_type_from_to_key').on(t.relationTypeId, t.fromEntityId, t.toEntityId),
		check('relation_from_ne_to', sql`${t.fromEntityId} <> ${t.toEntityId}`)
	]
);
