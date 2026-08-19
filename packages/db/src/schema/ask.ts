// Decision O3 (docs/ux/DECISIONS.md, round ten) and issue #290. The Loremaster's composer
// has two exits, "open in Ask" and "keep", and keep is the only one that writes. That is
// the whole reason this file is small: a table that held every question anybody typed
// would be a chat transcript, and what makes the dedicated page a history instead is that
// a row exists here only because somebody chose to save it.
//
// Two rules the columns below enforce rather than describe:
//
//  1. Guardrail 1. A kept answer is a note, never a revision. Nothing here points at
//     `revision`, `proposal` or `entity.body`, and no query in packages/db writes canon
//     from one of these rows. The answer text lives in `kept_answer.answer` and reaches
//     canon only the way any other AI text does, through a proposal somebody accepts.
//  2. The sources are references, not prose. A kept answer cites entries by id, so a
//     rename shows the new name and a click still has a target for G5's side panel. What
//     *is* snapshotted is the sentence that was cited (`kept_answer_source.statement`),
//     because the answer was grounded on the wording as it read that day and a later
//     revision does not retroactively change what the Loremaster read.
import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { entity } from './entity.js';
import { askDetailLevelEnum, keptAnswerSourceKindEnum } from './enums.js';
import { dataSource } from './source.js';
import { universe } from './universe.js';

export const keptAnswer = pgTable(
	'kept_answer',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		universeId: uuid('universe_id')
			.notNull()
			.references(() => universe.id, { onDelete: 'cascade' }),
		// The account whose note this is, and the only account that sees or deletes it. The
		// issue calls a kept answer "the GM's own note about their own world", so it is
		// scoped to the person rather than to the universe's membership: a co-editor never
		// reads somebody else's saved answers and never deletes one. Cascade, not set null:
		// a note nobody owns is not a record of anything, so deleting the account removes it
		// rather than leaving an anonymous row behind.
		keptBy: text('kept_by')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		question: text('question').notNull(),
		answer: text('answer').notNull(),
		// Which of SPEC.md §5's five detail levels produced this answer. Kept because the
		// same question at '1_line' and at 'full' are different answers, and a history that
		// showed only the text would make the short ones look like bad answers.
		detailLevel: askDetailLevelEnum('detail_level').notNull(),
		// SPEC.md §17: the answer is written in the reader's interface language whatever
		// language the canon it cites is in, so the row records which one that was.
		// `proposal.locale` exists for the same reason, and the history needs it to avoid
		// rendering an Italian answer as though the chrome's language were the text's.
		locale: text('locale').notNull(),
		// Which page it was asked from, so the history says where the question came up. O3's
		// composer floats over whatever the GM was reading, and "I asked this while reading
		// Aldric Vane" is most of what makes an old answer legible again. Path only, never an
		// absolute URL, which the check constraint below enforces.
		askedFromPath: text('asked_from_path').notNull(),
		// Guardrail 5, in the record and not only in the sentence beside it: which provider
		// actually generated this text. Both null for `runAsk`'s reading-only branch, where
		// generation is off and the answer is the GM's own sentences quoted back with no
		// model call at all, which is a materially different disclosure.
		provider: text('provider'),
		modelId: text('model_id'),
		// The moment of keeping, not the moment of asking. Those are seconds apart and only
		// one of them is an event this product records.
		keptAt: timestamp('kept_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// The history query, and the only one there is: this account's kept answers in this
		// universe, newest first.
		index('kept_answer_universe_kept_by_idx').on(t.universeId, t.keptBy, t.keptAt),
		check('kept_answer_question_present', sql`length(btrim(${t.question})) > 0`),
		check('kept_answer_answer_present', sql`length(btrim(${t.answer})) > 0`),
		// A path, so the history's own link cannot be turned into an off-site redirect by
		// whatever the caller passed. `//host` is a protocol-relative URL, so a leading
		// slash alone is not enough.
		check(
			'kept_answer_asked_from_path_relative',
			sql`${t.askedFromPath} like '/%' and ${t.askedFromPath} not like '//%'`
		)
	]
);

// Guardrail 3's shape applied to a record rather than to a proposal: which entry, which
// sentence. One row per source the answer was shown with, in the order it was shown.
export const keptAnswerSource = pgTable(
	'kept_answer_source',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		keptAnswerId: uuid('kept_answer_id')
			.notNull()
			.references(() => keptAnswer.id, { onDelete: 'cascade' }),
		// The order the sources were listed in beside the answer, which is retrieval order
		// and therefore part of the evidence.
		rank: integer('rank').notNull(),
		kind: keptAnswerSourceKindEnum('kind').notNull(),
		// `own_canon`: the entry itself, so the name shown is whatever the entry is called
		// now and the click has a real target. Set null rather than cascade when the entry is
		// deleted: the citation stays in the record, with its snapshotted sentence, and the
		// surface says the entry is gone instead of quietly shortening the source list and
		// making the answer look less grounded than it was.
		entityId: uuid('entity_id').references(() => entity.id, { onDelete: 'set null' }),
		// `indexed`: the corpus the page came from. SPEC.md §7 requires attribution and the
		// licence on every answer this source appears in, and both are read live from
		// `data_source` for the same reason the entry's name is: a licence review that
		// changes must not leave a stale licence sitting in an old record.
		dataSourceId: uuid('data_source_id').references(() => dataSource.id, {
			onDelete: 'set null'
		}),
		// An indexed page has no row of its own anywhere in this schema, so its title and URL
		// are the reference. Null for `own_canon`.
		pageTitle: text('page_title'),
		url: text('url'),
		// The sentence, or the retrieved chunk, exactly as the answer was grounded on it.
		// Deliberately a snapshot: this is what was read, not what the entry says today.
		// Spans are not stored with it, because an offset into a body that has since been
		// revised points at the wrong words rather than at none.
		statement: text('statement').notNull()
	},
	(t) => [
		uniqueIndex('kept_answer_source_rank_key').on(t.keptAnswerId, t.rank),
		index('kept_answer_source_entity_idx').on(t.entityId),
		// Which columns each kind may use. Without these, an `own_canon` row whose entry was
		// deleted would be indistinguishable from a malformed `indexed` one.
		check(
			'kept_answer_source_own_canon_shape',
			sql`${t.kind} <> 'own_canon' or (${t.dataSourceId} is null and ${t.pageTitle} is null and ${t.url} is null)`
		),
		check(
			'kept_answer_source_indexed_shape',
			sql`${t.kind} <> 'indexed' or (${t.entityId} is null and ${t.pageTitle} is not null and ${t.url} is not null)`
		)
	]
);
