// Issue #290, decision O3. The whole write and read path for a kept Ask answer, and
// deliberately nothing else: keep, list, read one, delete. `keepAnswer` is the only writer
// and it writes to two tables neither of which touches canon, so guardrail 1 holds by
// construction rather than by review. There is no accept here, no revision, no proposal,
// and no function in this module that turns a kept answer into any of those. Promoting a
// kept answer to canon means asking the Loremaster to propose the change and accepting the
// proposal, exactly as any other AI text does.
//
// Retention, which question 2 of the issue asks: a kept answer is the GM's own note about
// their own world, so nothing expires it and nothing sweeps it. `deleteKeptAnswer` issues a
// real `delete`, with no soft-delete column anywhere in the schema to make "gone" mean
// "hidden", and `kept_answer_source` follows on the foreign key's cascade.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { AskDetailLevel, EntityType, KeptAnswerSourceKind } from '../schema/enums.js';
import { keptAnswer, keptAnswerSource } from '../schema/ask.js';
import { dataSource } from '../schema/source.js';

export type KeptAnswerRow = typeof keptAnswer.$inferSelect;

/** Thrown when `keepAnswer` is handed a source it cannot store: a kind whose required
 * reference is missing. The database's own check constraints would refuse these too, and
 * this exists so the caller gets a sentence naming the offending source instead of a
 * constraint name from Postgres. */
export class KeptAnswerSourceInvalidError extends Error {
	constructor(
		readonly rank: number,
		reason: string
	) {
		super(`source ${rank} cannot be kept: ${reason}`);
		this.name = 'KeptAnswerSourceInvalidError';
	}
}

/** One citation as it was shown beside the answer. Mirrors `runAsk`'s `AskSource` union,
 * reduced to what a record needs: the reference (`entityId`, or `dataSourceId` with the
 * page's title and URL) plus the sentence it was grounded on. Names, attribution and
 * licences are deliberately absent, because those are read live at list time from the entry
 * and the corpus rather than frozen here. */
export type KeepAnswerSourceInput =
	| {
			kind: 'own_canon';
			entityId: string;
			statement: string;
	  }
	| {
			kind: 'indexed';
			dataSourceId: string | null;
			pageTitle: string;
			url: string;
			statement: string;
	  };

export interface KeepAnswerInput {
	universeId: string;
	/** The account keeping it, which is also the only account that will ever read or delete
	 * it. Membership in the universe is the caller's check, not this function's. */
	keptBy: string;
	question: string;
	answer: string;
	detailLevel: AskDetailLevel;
	/** The interface locale the answer was written in (SPEC.md §17), not the language of the
	 * canon it cites. */
	locale: string;
	/** The path the question was asked from, for example `/w/valdoria-reach/e/aldric-vane`.
	 * A path, never an absolute URL. */
	askedFromPath: string;
	/** Guardrail 5: which provider generated this text. Both null when generation was off
	 * for the universe and `runAsk` returned its reading-only answer, which is a different
	 * disclosure and has to stay distinguishable in the record. */
	provider?: string | null;
	modelId?: string | null;
	/** Issue #437, decision T10: which conversation this turn belongs to, so a multi-turn
	 * session groups back into one history entry instead of `listKeptConversations`
	 * seeing loose rows with nothing tying them together. Omit it and the column's own
	 * `defaultRandom()` gives the row a conversation of one - every caller in this
	 * codebase always sends one today (issue #455), but a future one-off caller with
	 * nothing to group against is still free to omit it. */
	conversationId?: string;
	/** In the order they were shown, which is retrieval order. */
	sources: KeepAnswerSourceInput[];
}

/** The interface #285's "keep" exit calls, through
 * `POST /w/[universe]/ask/keep` in apps/web. One transaction: the answer and every citation
 * land together or not at all, because a kept answer with half its evidence would be a
 * worse record than no row. */
export async function keepAnswer(db: Db, input: KeepAnswerInput): Promise<KeptAnswerRow> {
	input.sources.forEach((source, i) => {
		if (source.statement.trim().length === 0) {
			throw new KeptAnswerSourceInvalidError(i, 'no statement to cite');
		}
		if (source.kind === 'own_canon' && source.entityId.length === 0) {
			throw new KeptAnswerSourceInvalidError(i, 'own canon needs an entity id');
		}
		if (source.kind === 'indexed' && (source.pageTitle.length === 0 || source.url.length === 0)) {
			throw new KeptAnswerSourceInvalidError(i, 'an indexed page needs a title and a URL');
		}
	});

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(keptAnswer)
			.values({
				universeId: input.universeId,
				keptBy: input.keptBy,
				question: input.question.trim(),
				answer: input.answer.trim(),
				detailLevel: input.detailLevel,
				locale: input.locale,
				askedFromPath: input.askedFromPath,
				provider: input.provider ?? null,
				modelId: input.modelId ?? null,
				// Omitted (`undefined`) rather than a generated fallback here: the column's own
				// `defaultRandom()` is what a caller with nothing to group against actually wants.
				conversationId: input.conversationId
			})
			.returning();
		if (!row) throw new Error('keeping an answer did not return a row');

		if (input.sources.length > 0) {
			await tx.insert(keptAnswerSource).values(
				input.sources.map((source, rank) => ({
					keptAnswerId: row.id,
					rank,
					kind: source.kind,
					entityId: source.kind === 'own_canon' ? source.entityId : null,
					dataSourceId: source.kind === 'indexed' ? source.dataSourceId : null,
					pageTitle: source.kind === 'indexed' ? source.pageTitle : null,
					url: source.kind === 'indexed' ? source.url : null,
					statement: source.statement
				}))
			);
		}

		return row;
	});
}

export interface KeptAnswerSourceRecord {
	id: string;
	rank: number;
	kind: KeptAnswerSourceKind;
	/** Resolved now, not when the answer was kept, which is the point of storing a reference:
	 * a renamed entry shows its current name and the click still opens G5's side panel. Null
	 * when the entry has since been deleted, which the surface says out loud rather than
	 * dropping the citation. */
	entity: { id: string; name: string; slug: string; type: EntityType } | null;
	/** Also resolved now, for the same reason and one more: SPEC.md §7 requires attribution
	 * and the licence on every answer this source appears in, and a licence review that
	 * changed since must not be quoted stale. Null when the corpus was removed. */
	dataSource: {
		id: string;
		name: string;
		attribution: string;
		licence: string | null;
		licenceUrl: string | null;
	} | null;
	pageTitle: string | null;
	url: string | null;
	/** The sentence as the answer was grounded on it. A snapshot on purpose. */
	statement: string;
}

export interface KeptAnswerRecord {
	id: string;
	question: string;
	answer: string;
	detailLevel: AskDetailLevel;
	locale: string;
	askedFromPath: string;
	provider: string | null;
	modelId: string | null;
	/** Issue #437: which conversation this turn groups with. Always present - the column
	 * itself is never null, even for a row nobody explicitly grouped. */
	conversationId: string;
	keptAt: Date;
	sources: KeptAnswerSourceRecord[];
}

export interface ListKeptAnswersInput {
	universeId: string;
	keptBy: string;
	limit?: number;
}

const DEFAULT_LIST_LIMIT = 50;

/** The history, newest first, scoped to one account in one universe. Two queries rather
 * than a join with rows fanned out per source, because the answer text is the largest
 * column here and repeating it once per citation is the one thing this read should not do. */
export async function listKeptAnswers(
	db: Db,
	input: ListKeptAnswersInput
): Promise<KeptAnswerRecord[]> {
	const rows = await db
		.select()
		.from(keptAnswer)
		.where(and(eq(keptAnswer.universeId, input.universeId), eq(keptAnswer.keptBy, input.keptBy)))
		.orderBy(desc(keptAnswer.keptAt))
		.limit(input.limit ?? DEFAULT_LIST_LIMIT);
	if (rows.length === 0) return [];

	const sources = await sourcesFor(
		db,
		rows.map((row) => row.id)
	);
	return rows.map((row) => ({
		id: row.id,
		question: row.question,
		answer: row.answer,
		detailLevel: row.detailLevel,
		locale: row.locale,
		askedFromPath: row.askedFromPath,
		provider: row.provider,
		modelId: row.modelId,
		conversationId: row.conversationId,
		keptAt: row.keptAt,
		sources: sources.get(row.id) ?? []
	}));
}

/** Issue #437, decision T10: one entry in the Ask page's history per conversation rather
 * than per turn - the shape the page actually wants once every turn is kept
 * automatically, because a reader of a conversation wants the conversation, not a pile of
 * loose answers it happened to produce. */
export interface KeptConversation {
	conversationId: string;
	/** The latest turn's `keptAt`, so a list of conversations sorts by the same "most
	 * recently active" rule the old flat list sorted individual answers by. */
	keptAt: Date;
	/** Oldest first: the order the conversation was actually asked in, not the order a
	 * "newest first" answer list would have put its own rows in. */
	turns: KeptAnswerRecord[];
}

const DEFAULT_CONVERSATION_LIMIT = 50;
// A generous backstop on the flat row read behind the grouping below, not a real ceiling
// a GM's own history is expected to hit: 50 conversations averaging a handful of turns
// each is comfortably under this, and it exists only so one degenerate conversation with
// thousands of turns cannot starve every other conversation off the page.
const CONVERSATION_ROWS_LIMIT = 1000;

/** The conversation list `ask/kept` renders (issue #437). Two queries, same shape
 * `listKeptAnswers` already uses, grouped in memory afterward: a `group by` in SQL would
 * still need a second query for `sourcesFor` to run against every turn it found, so
 * nothing is saved by pushing the grouping into Postgres instead of here. */
export async function listKeptConversations(
	db: Db,
	input: ListKeptAnswersInput
): Promise<KeptConversation[]> {
	const rows = await db
		.select()
		.from(keptAnswer)
		.where(and(eq(keptAnswer.universeId, input.universeId), eq(keptAnswer.keptBy, input.keptBy)))
		.orderBy(asc(keptAnswer.keptAt))
		.limit(CONVERSATION_ROWS_LIMIT);
	if (rows.length === 0) return [];

	const sources = await sourcesFor(
		db,
		rows.map((row) => row.id)
	);
	const byConversation = new Map<string, KeptAnswerRecord[]>();
	for (const row of rows) {
		const turns = byConversation.get(row.conversationId) ?? [];
		turns.push({
			id: row.id,
			question: row.question,
			answer: row.answer,
			detailLevel: row.detailLevel,
			locale: row.locale,
			askedFromPath: row.askedFromPath,
			provider: row.provider,
			modelId: row.modelId,
			conversationId: row.conversationId,
			keptAt: row.keptAt,
			sources: sources.get(row.id) ?? []
		});
		byConversation.set(row.conversationId, turns);
	}

	const conversations = [...byConversation.entries()].map(
		([conversationId, turns]): KeptConversation => ({
			conversationId,
			keptAt: turns[turns.length - 1]!.keptAt,
			turns
		})
	);
	conversations.sort((a, b) => b.keptAt.getTime() - a.keptAt.getTime());
	return conversations.slice(0, input.limit ?? DEFAULT_CONVERSATION_LIMIT);
}

export interface GetKeptConversationInput {
	conversationId: string;
	universeId: string;
	keptBy: string;
}

/** One conversation's turns, oldest first, scoped by universe and owner - the read
 * `/w/[universe]/ask/[conversationId]` needs (issue #455, decision U11): opening a
 * specific conversation, whether from `ask/kept`'s index or from the dock's "open in
 * Ask", rather than the page only ever being able to show the newest one. Null for a
 * wrong id and for somebody else's conversation, the same way `keptAnswerById` already
 * answers those two cases identically, so a probe cannot tell them apart. */
export async function getKeptConversation(
	db: Db,
	input: GetKeptConversationInput
): Promise<KeptConversation | null> {
	const rows = await db
		.select()
		.from(keptAnswer)
		.where(
			and(
				eq(keptAnswer.conversationId, input.conversationId),
				eq(keptAnswer.universeId, input.universeId),
				eq(keptAnswer.keptBy, input.keptBy)
			)
		)
		.orderBy(asc(keptAnswer.keptAt));
	if (rows.length === 0) return null;

	const sources = await sourcesFor(
		db,
		rows.map((row) => row.id)
	);
	const turns: KeptAnswerRecord[] = rows.map((row) => ({
		id: row.id,
		question: row.question,
		answer: row.answer,
		detailLevel: row.detailLevel,
		locale: row.locale,
		askedFromPath: row.askedFromPath,
		provider: row.provider,
		modelId: row.modelId,
		conversationId: row.conversationId,
		keptAt: row.keptAt,
		sources: sources.get(row.id) ?? []
	}));
	return { conversationId: input.conversationId, keptAt: turns[turns.length - 1]!.keptAt, turns };
}

export interface DeleteKeptConversationInput {
	conversationId: string;
	universeId: string;
	keptBy: string;
}

/** Issue #437's own new capability: "the product now stores everything rather than what
 * somebody chose", so the unit a GM can actually discard has to be the conversation, not
 * one turn cherry-picked out of an automatic transcript. Every row sharing the id goes,
 * with `kept_answer_source` following each on its own cascade - the same real, unflagged
 * delete `deleteKeptAnswer` always did, just scoped to the whole group. Returns false when
 * there was nothing this account could delete, the same answer for a wrong id and for
 * somebody else's. */
export async function deleteKeptConversation(
	db: Db,
	input: DeleteKeptConversationInput
): Promise<boolean> {
	const deleted = await db
		.delete(keptAnswer)
		.where(
			and(
				eq(keptAnswer.conversationId, input.conversationId),
				eq(keptAnswer.universeId, input.universeId),
				eq(keptAnswer.keptBy, input.keptBy)
			)
		)
		.returning({ id: keptAnswer.id });
	return deleted.length > 0;
}

export interface KeptAnswerRefInput {
	id: string;
	universeId: string;
	keptBy: string;
}

/** One kept answer, with the same live resolution `listKeptAnswers` does. Scoped by
 * universe and owner in the query itself, so a wrong id and somebody else's id are the same
 * null and a probe cannot tell them apart. */
export async function keptAnswerById(
	db: Db,
	input: KeptAnswerRefInput
): Promise<KeptAnswerRecord | null> {
	const [row] = await db
		.select()
		.from(keptAnswer)
		.where(
			and(
				eq(keptAnswer.id, input.id),
				eq(keptAnswer.universeId, input.universeId),
				eq(keptAnswer.keptBy, input.keptBy)
			)
		)
		.limit(1);
	if (!row) return null;
	const sources = await sourcesFor(db, [row.id]);
	return {
		id: row.id,
		question: row.question,
		answer: row.answer,
		detailLevel: row.detailLevel,
		locale: row.locale,
		askedFromPath: row.askedFromPath,
		provider: row.provider,
		modelId: row.modelId,
		conversationId: row.conversationId,
		keptAt: row.keptAt,
		sources: sources.get(row.id) ?? []
	};
}

/** Question 2 of the issue, in one statement: the row is gone. Not flagged, not archived,
 * not hidden behind a `deleted_at` the history filters on. `kept_answer_source` goes with it
 * on the cascade. Returns false when there was nothing this account could delete, which is
 * the same answer for a wrong id and for somebody else's. */
export async function deleteKeptAnswer(db: Db, input: KeptAnswerRefInput): Promise<boolean> {
	const deleted = await db
		.delete(keptAnswer)
		.where(
			and(
				eq(keptAnswer.id, input.id),
				eq(keptAnswer.universeId, input.universeId),
				eq(keptAnswer.keptBy, input.keptBy)
			)
		)
		.returning({ id: keptAnswer.id });
	return deleted.length > 0;
}

async function sourcesFor(
	db: Db,
	keptAnswerIds: string[]
): Promise<Map<string, KeptAnswerSourceRecord[]>> {
	const rows = await db
		.select({
			id: keptAnswerSource.id,
			keptAnswerId: keptAnswerSource.keptAnswerId,
			rank: keptAnswerSource.rank,
			kind: keptAnswerSource.kind,
			pageTitle: keptAnswerSource.pageTitle,
			url: keptAnswerSource.url,
			statement: keptAnswerSource.statement,
			entityId: entity.id,
			entityName: entity.name,
			entitySlug: entity.slug,
			entityType: entity.type,
			dataSourceId: dataSource.id,
			dataSourceName: dataSource.name,
			attribution: dataSource.attribution,
			licence: dataSource.licence,
			licenceUrl: dataSource.licenceUrl
		})
		.from(keptAnswerSource)
		.leftJoin(entity, eq(entity.id, keptAnswerSource.entityId))
		.leftJoin(dataSource, eq(dataSource.id, keptAnswerSource.dataSourceId))
		.where(inArray(keptAnswerSource.keptAnswerId, keptAnswerIds))
		.orderBy(asc(keptAnswerSource.keptAnswerId), asc(keptAnswerSource.rank));

	const byAnswer = new Map<string, KeptAnswerSourceRecord[]>();
	for (const row of rows) {
		const list = byAnswer.get(row.keptAnswerId) ?? [];
		list.push({
			id: row.id,
			rank: row.rank,
			kind: row.kind,
			entity:
				row.entityId && row.entityName && row.entitySlug && row.entityType
					? { id: row.entityId, name: row.entityName, slug: row.entitySlug, type: row.entityType }
					: null,
			dataSource:
				row.dataSourceId && row.dataSourceName !== null && row.attribution !== null
					? {
							id: row.dataSourceId,
							name: row.dataSourceName,
							attribution: row.attribution,
							licence: row.licence,
							licenceUrl: row.licenceUrl
						}
					: null,
			pageTitle: row.pageTitle,
			url: row.url,
			statement: row.statement
		});
		byAnswer.set(row.keptAnswerId, list);
	}
	return byAnswer;
}
