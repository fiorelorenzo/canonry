import { sql } from 'drizzle-orm';
import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { entityTypeEnum, entityVisibilityEnum, languageSourceEnum } from './enums.js';
import { mediaAsset } from './media.js';
import { universe } from './universe.js';

// SPEC.md §4.2: a typed entry. `aliases` is mandatory, not decoration - it is what makes
// mention detection work, hence the GIN index for alias lookups.
export const entity = pgTable(
	'entity',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		type: entityTypeEnum('type').notNull(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		aliases: text('aliases')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		body: text('body').notNull().default(''),
		// SPEC.md §17: canon keeps its own language, per entry, because mixed-language worlds are
		// the normal case in this hobby. This is what the copilot reads before it drafts anything
		// that will land *inside* an entry: an Italian interface must never start writing Italian
		// paragraphs into an English entry. A BCP-47 primary subtag ('en', 'it'), detected from
		// the body at write time by a free heuristic and never by a model call, overridable by the
		// GM, and null when it is unknown or the body is genuinely mixed. Null is a real answer
		// here, not a missing one: guessing from three words is how an entry gets mislabelled and
		// then written into in the wrong language.
		language: text('language'),
		// Whether that value was detected or chosen. Detection may revisit a 'detected' row on any
		// save; it must never touch a 'human' one, including when the human's answer was "mixed"
		// and therefore null. Without this column those two nulls are indistinguishable and the
		// GM's explicit answer would be re-guessed on their next keystroke.
		languageSource: languageSourceEnum('language_source').notNull().default('detected'),
		// SPEC.md §9: style is shared at universe level and overridable per entry. Null
		// means "use the universe's style", which is the case for almost every entry.
		imagePromptModifier: text('image_prompt_modifier'),
		// O2 (#284): the entry's cover image, the one that draws the band above its title.
		// It lives here and not as a `role`/`primary` column on `media_asset` because one
		// cover per entity is a single fact about the entity: a role column invites two rows
		// both claiming it with nothing in the schema stopping them, whereas a single
		// nullable column can only ever name one. `set null` rather than `cascade`: deleting
		// the picture must lose the cover, never the entry. Null is the normal state, and it
		// draws no band and no placeholder at all (the decision is explicit that an empty
		// slot on every thin entry reads worse than no slot).
		//
		// Guardrail 1: nothing writes this except a GM pressing "use as cover" in the Images
		// panel, which is that image's accept. Guardrail 6: this column says nothing about
		// players - `media_asset.published_to_players` still decides whether the cover
		// reaches `/p/<slug>`, and a cover is not a special case of a published image.
		//
		// The `AnyPgColumn` annotation is what lets this reference `media_asset` while
		// `media_asset.entity_id` references back: the cycle is real in the database and
		// harmless (drizzle resolves both sides lazily), but TypeScript needs the return type
		// spelled out to stop inferring one table's type from the other's.
		coverAssetId: uuid('cover_asset_id').references((): AnyPgColumn => mediaAsset.id, {
			onDelete: 'set null'
		}),
		// Guardrail 6: `revealable` still needs a `revelation` row (players' wiki, a later
		// wave) to actually reach players. `gm_only` can never be revealed.
		visibility: entityVisibilityEnum('visibility').notNull().default('revealable'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('entity_universe_slug_key').on(t.universeId, t.slug),
		index('entity_aliases_gin_idx').using('gin', t.aliases)
	]
);
