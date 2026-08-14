// SPEC.md §9. Generation is part of the product, and three guardrails shape these tables:
// images are born private to the GM, they never flow automatically into the players' wiki
// (guardrail 6, issue #71), and they stay marked as generated for as long as they exist.
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
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { entity } from './entity.js';
import { imageFeatureEnum, mediaKindEnum } from './enums.js';
import { universe } from './universe.js';

// Style is shared at universe level through a prompt modifier and overridable per entry
// (decision F1, SPEC.md §9). Kept as its own table rather than a column so a universe can
// carry a named style with notes, and so the seeded default is a row somebody can read.
export const imageStyle = pgTable(
	'image_style',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		promptModifier: text('prompt_modifier').notNull(),
		notes: text('notes').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('image_style_universe_idx').on(t.universeId)]
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
		// Guardrail 6 and issue #71: false until a human publishes it, and no code path
		// flips this as a side effect of anything else.
		publishedToPlayers: boolean('published_to_players').notNull().default(false),
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
