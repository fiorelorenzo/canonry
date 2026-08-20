// SPEC.md §9. Generation is part of the product, and three guardrails shape these tables:
// images are born private to the GM (no `entity_id`) and reach players only once a GM
// attaches one - the accept guardrail 6 asks for (issue #382) - to an entry that is
// itself revealed; `gm_only` is the one further exception, and they stay marked as
// generated for as long as they exist.
//
// The active model lives in the database per feature and is the one always used, following
// ai-game's `image_generation_feature_config` pattern, so switching model is an admin edit
// rather than a deploy.
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
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { entity } from './entity.js';
import { imageFeatureEnum, mediaKindEnum } from './enums.js';
import { universe } from './universe.js';

// Style is shared at universe level through a prompt modifier and overridable per entry
// (decision F1, SPEC.md §9). Kept as its own table rather than a column so a universe can
// carry a named style with notes, and so the seeded default is a row somebody can read.
//
// Issue #407, decision S2: `universe_id IS NULL` splits the table in two rather than
// adding a second one. A shipped preset is a row with no universe - `slug`, `description`,
// `example_path` and `sort_order` all exist only for it, and are null on a custom row,
// which the picker never shows an example or a sort position for. A custom row is the
// opposite: only `name`/`prompt_modifier` are ever written to it (upsertUniverseImageStyle,
// queries/media.ts), and the unique index on `universe_id` below is "one custom style per
// universe" as a real constraint - postgres treats every null the same way it treats every
// null `slug`, so the six presets are unrestricted by it.
export const imageStyle = pgTable(
	'image_style',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'cascade' }),
		// Stable identity for a preset, so a re-seed's `ON CONFLICT (slug)` updates the row
		// in place instead of accumulating a duplicate (migration 0048). Never set on a
		// custom row.
		slug: text('slug').unique(),
		name: text('name').notNull(),
		// English picker copy for a preset; `image_style_label` below carries every other
		// shipped locale (@canonry/lang's LOCALES). Null on a custom row - the picker shows
		// no description for one.
		description: text('description'),
		promptModifier: text('prompt_modifier').notNull(),
		// A static path under apps/web/static the picker card renders. Null on a custom row.
		examplePath: text('example_path'),
		// Display order in the picker grid. Meaningless for a custom row - the picker always
		// draws it last, as its own fixed card.
		sortOrder: integer('sort_order').notNull().default(0),
		notes: text('notes').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('image_style_universe_idx').on(t.universeId)]
);

// Issue #407: a preset's translation into every shipped locale but English, mirroring
// relation_type_label's own shape and its own reasoning (schema/relation.ts) - locale is
// free text, not an enum, because the set of shipped locales lives in @canonry/lang's
// LOCALES, not in Postgres, so adding a language never needs a migration here. Never
// written for a custom row: a GM's own style has no translation, only their own text.
export const imageStyleLabel = pgTable(
	'image_style_label',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		imageStyleId: uuid('image_style_id')
			.notNull()
			.references(() => imageStyle.id, { onDelete: 'cascade' }),
		locale: text('locale').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('image_style_label_style_locale_key').on(t.imageStyleId, t.locale)]
);

// One active row per feature. `portrait` uses the single-image model, `variants` uses the
// batch model, because SPEC.md §9 seeds prunaai/p-image as the default and flux-schnell
// only where a batch of up to four is wanted.
export const imageModelConfig = pgTable(
	'image_model_config',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		feature: imageFeatureEnum('feature').notNull(),
		provider: text('provider').notNull().default('replicate'),
		modelId: text('model_id').notNull(),
		active: boolean('active').notNull().default(true),
		params: jsonb('params').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('image_model_active_feature_key')
			.on(t.feature)
			.where(sql`${t.active} = true`)
	]
);

// Stored, never referenced: SPEC.md §6.3 says a source that disappears must not take the
// pictures with it, so an imported image is copied in and this row points at our own copy.
export const mediaAsset = pgTable(
	'media_asset',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		entityId: uuid('entity_id').references(() => entity.id, { onDelete: 'cascade' }),
		kind: mediaKindEnum('kind').notNull(),
		// Path under the media root, not a URL: the file is served by the app behind Caddy.
		path: text('path').notNull(),
		mimeType: text('mime_type').notNull(),
		bytes: integer('bytes').notNull().default(0),
		// Null for an imported file. Set for anything a model made, together with the model
		// that made it, because guardrail 2's cousin applies to pictures: generated stays
		// marked as generated.
		prompt: text('prompt'),
		provider: text('provider'),
		modelId: text('model_id'),
		generated: boolean('generated').notNull().default(false),
		// Guardrail 6 and issue #382: an image's audience follows its entry - attaching it
		// is the accept, not a second publish click. `gm_only` is the deliberate exception
		// that holds a picture back from players even after its entry is revealed, false
		// by default, and no code path flips it as a side effect of anything else.
		gmOnly: boolean('gm_only').notNull().default(false),
		// For the similarity cache of SPEC.md §9: the vector lives in Qdrant, this is the
		// key that ties a hit back to the stored file.
		similarityKey: text('similarity_key'),
		credits: numeric('credits', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('media_asset_entity_idx').on(t.entityId),
		index('media_asset_universe_kind_idx').on(t.universeId, t.kind),
		index('media_asset_similarity_idx').on(t.similarityKey)
	]
);
