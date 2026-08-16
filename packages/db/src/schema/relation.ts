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
		// Decision L1, issue #195: stable, language-independent identity, split off from
		// `label` because a display string cannot also be a database key once it gets
		// translated. The ten shipped keys are hand-picked API surface, set once by
		// migration 0032 and never renamed. A universe's own type gets a key derived from
		// its authored label at creation (0032's `relation_type_derive_key_trigger`) and
		// keeps that key through a rename - `renameRelationType` only ever writes
		// `label`/`inverseLabel`. The `default('')` below exists only so an insert that
		// omits `key` (every existing call site, and the trigger's own normal path) still
		// type-checks as optional; Postgres never actually stores an empty key, the
		// trigger overwrites it before the row lands.
		key: text('key').notNull().default(''),
		label: text('label').notNull(),
		inverseLabel: text('inverse_label').notNull(),
		cardinality: relationCardinalityEnum('cardinality').notNull(),
		allowedFrom: entityTypeEnum('allowed_from').array().notNull(),
		allowedTo: entityTypeEnum('allowed_to').array().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('relation_type_universe_key_key').on(t.universeId, t.key).nullsNotDistinct(),
		// Kept alongside the key constraint rather than replaced by it: a key survives a
		// rename by design (that is the whole point of #195), so two of a universe's own
		// types could still end up reading identically after a rename even though their
		// keys differ. This is what still stops that - a GM must never see two catalogue
		// entries with the same display label, whatever their underlying keys are.
		unique('relation_type_universe_label_key').on(t.universeId, t.label).nullsNotDistinct()
	]
);

// Issue #198 (decision L1's opt-in half): a universe's own type displays as authored in
// every interface language by default (SPEC.md §17 rule 3) - this table is what lets a
// bilingual GM add a per-locale reading on top of that default without it ever becoming
// automatic. One row per (relation_type, locale): `label`/`inverseLabel` mirror
// `relation_type`'s own pair so the perspective-resolved rendering RelationView already
// does needs no new branch, just a different source row. `authorKind` reuses
// `author_kind` rather than inventing a second enum - guardrail 1's distinction between
// human and accepted-from-a-model is the same distinction here, on a smaller unit than a
// whole revision.
//
// The shipped ten never get a row here - their strings live in the i18n bundle (#196),
// and a translation sitting in both places could disagree with nothing to reconcile
// them. Made impossible, not merely discouraged, by
// `relation_type_label_owned_only_trigger` in this table's migration: a shipped type's
// `universe_id` is null, and the trigger below rejects any insert or update whose
// `relation_type_id` points at one. A `CHECK` constraint cannot reach across tables to
// enforce this in Postgres, which is why it is a trigger and not a constraint on this
// table's own columns, matching 0032_relation_type_key.sql's precedent for the same
// reason.
//
// `locale` is free text, not an enum - every other locale column in this schema
// (`proposal.locale`, `canon_save_job.locale`, `user.locale`) makes the same choice: the
// set of shipped locales lives in `@canonry/lang`'s `LOCALES`, not in Postgres, so
// adding a language never needs a migration here.
export const relationTypeLabel = pgTable(
	'relation_type_label',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		relationTypeId: uuid('relation_type_id')
			.notNull()
			.references(() => relationType.id, { onDelete: 'cascade' }),
		locale: text('locale').notNull(),
		label: text('label').notNull(),
		inverseLabel: text('inverse_label').notNull(),
		authorKind: authorKindEnum('author_kind').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('relation_type_label_type_locale_key').on(t.relationTypeId, t.locale)]
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
