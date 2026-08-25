// Issue #451, decision U2. The Loremaster's voice on `image_style`'s own shape (issue
// #407, decision S2, schema/media.ts): a shipped catalogue of presets a universe points
// at, plus the universe's own custom row when nothing shipped fits. Where this differs on
// purpose - a voice has no per-entry override the way a style does (`pickStyle`'s cascade,
// packages/media/src/style.ts, has no equivalent here), so there is exactly one place this
// is ever resolved from: `universe.narration_style_id`.

import { integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { universe } from './universe.js';

// Issue #407, decision S2's own reasoning, unchanged for the second table that copies it:
// `universe_id IS NULL` splits the table in two rather than adding a second one. A shipped
// preset is a row with no universe - `slug`, `description`, `example_sentence` and
// `sort_order` all exist only for it, and are null on a custom row, which the picker never
// shows a description, an example or a sort position for. A custom row is the opposite:
// only `name`/`prompt_clause` are ever written to it (`upsertUniverseNarrationStyle`,
// queries/narration.ts), and the unique index on `universe_id` below is "one custom voice
// per universe" as a real constraint - postgres treats every null the same way it treats
// every null `slug`, so the shipped presets are unrestricted by it.
export const narrationStyle = pgTable(
	'narration_style',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id').references(() => universe.id, { onDelete: 'cascade' }),
		// Stable identity for a preset, so a re-seed's `ON CONFLICT (slug)` updates the row
		// in place instead of accumulating a duplicate. Never set on a custom row.
		slug: text('slug').unique(),
		name: text('name').notNull(),
		// English picker copy for a preset; `narration_style_label` below carries every
		// other shipped locale (@canonry/lang's LOCALES). Null on a custom row - the picker
		// shows no description for one.
		description: text('description'),
		// The clause `loremasterVoiceInstruction` (packages/copilot/src/speech.ts) appends
		// to the system prompt verbatim - a preset's own tone directive, or the GM's own
		// words on a custom row. What `universe.loremaster_description` held before this
		// table existed; see this migration's own comment for how that text moved here.
		promptClause: text('prompt_clause').notNull(),
		// One sentence in the chosen voice, shown on the preset's card in place of
		// image_style's example image - as informative for a voice and costs nothing to
		// ship. Null on a custom row; `narration_style_label` below carries every other
		// shipped locale's translation of it (issue #796).
		exampleSentence: text('example_sentence'),
		// Display order in the picker grid. Meaningless for a custom row - the picker
		// always draws it last, as its own fixed card.
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('narration_style_universe_idx').on(t.universeId)]
);

// Mirrors `image_style_label`'s own shape and reasoning (schema/media.ts) - locale is free
// text, not an enum, for the same reason. Never written for a custom row: a GM's own voice
// has no translation, only their own words.
export const narrationStyleLabel = pgTable(
	'narration_style_label',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		narrationStyleId: uuid('narration_style_id')
			.notNull()
			.references(() => narrationStyle.id, { onDelete: 'cascade' }),
		locale: text('locale').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull(),
		// Issue #796: the card's example sentence in this locale. Nullable, unlike
		// name/description above - a locale can translate the picker copy before anyone
		// writes a sample in it, and `listNarrationStylePresets`'s coalesce falls back to
		// the row's own English `example_sentence` exactly the way a missing label row
		// already does for every other field.
		exampleSentence: text('example_sentence'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('narration_style_label_style_locale_key').on(t.narrationStyleId, t.locale)]
);
