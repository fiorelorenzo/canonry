import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { entityTypeEnum, entityVisibilityEnum } from './enums.js';
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
		// SPEC.md §9: style is shared at universe level and overridable per entry. Null
		// means "use the universe's style", which is the case for almost every entry.
		imagePromptModifier: text('image_prompt_modifier'),
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
