import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	deleteKeptAnswer,
	deleteKeptConversation,
	getKeptConversation,
	keepAnswer,
	keptAnswerById,
	KeptAnswerSourceInvalidError,
	listKeptAnswers,
	listKeptConversations,
	type Db
} from '../src/index.js';
import { keptAnswer, keptAnswerSource } from '../src/schema/ask.js';
import { entity } from '../src/schema/entity.js';
import { proposal } from '../src/schema/proposal.js';
import { revision } from '../src/schema/revision.js';
import { dataSource } from '../src/schema/source.js';
import {
	expectConstraintViolation,
	insertHomebrewUniverse,
	insertUser,
	testDb,
	unique
} from './helpers.js';

describe('kept answers', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture() {
		const u = await insertHomebrewUniverse(db);
		const [cited] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric-vane'),
				body: 'Aldric Vane keeps the Ledger honest by keeping it afraid.'
			})
			.returning();
		if (!cited) throw new Error('fixture setup failed');
		return { u, cited, keeper: u.ownerUserId };
	}

	function input(u: { id: string }, keeper: string, citedId: string) {
		return {
			universeId: u.id,
			keptBy: keeper,
			question: 'Who holds the Ashen Ledger to account?',
			answer: 'Aldric Vane does, by keeping it afraid.',
			detailLevel: 'normal' as const,
			locale: 'en',
			askedFromPath: '/w/valdoria-reach/e/aldric-vane',
			provider: 'google',
			modelId: 'gemini-2.5-flash',
			sources: [
				{
					kind: 'own_canon' as const,
					entityId: citedId,
					statement: 'Aldric Vane keeps the Ledger honest by keeping it afraid.'
				}
			]
		};
	}

	it('keeps a question, its answer and its sources as references', async () => {
		const { u, cited, keeper } = await fixture();
		const row = await keepAnswer(db, input(u, keeper, cited.id));

		const record = await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: keeper });
		expect(record).not.toBeNull();
		expect(record!.question).toBe('Who holds the Ashen Ledger to account?');
		expect(record!.detailLevel).toBe('normal');
		expect(record!.askedFromPath).toBe('/w/valdoria-reach/e/aldric-vane');
		expect(record!.provider).toBe('google');
		expect(record!.sources).toHaveLength(1);
		expect(record!.sources[0]!.entity).toEqual({
			id: cited.id,
			name: 'Aldric Vane',
			slug: cited.slug,
			type: 'character'
		});
	});

	// The reason sources are stored as references at all (issue #290): a renamed entry shows
	// the name it has now, and the sentence the answer was grounded on stays as it read.
	it('shows a renamed entry under its new name, with the cited sentence unchanged', async () => {
		const { u, cited, keeper } = await fixture();
		const row = await keepAnswer(db, input(u, keeper, cited.id));

		await db.update(entity).set({ name: 'Aldric Vane the Elder' }).where(eq(entity.id, cited.id));

		const record = await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: keeper });
		expect(record!.sources[0]!.entity!.name).toBe('Aldric Vane the Elder');
		expect(record!.sources[0]!.statement).toBe(
			'Aldric Vane keeps the Ledger honest by keeping it afraid.'
		);
	});

	// A deleted entry loses its click target, not its citation: dropping the row would make
	// an old answer read as less grounded than it actually was.
	it('keeps the citation when the entry it points at is deleted', async () => {
		const { u, cited, keeper } = await fixture();
		const row = await keepAnswer(db, input(u, keeper, cited.id));

		await db.delete(entity).where(eq(entity.id, cited.id));

		const record = await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: keeper });
		expect(record!.sources).toHaveLength(1);
		expect(record!.sources[0]!.kind).toBe('own_canon');
		expect(record!.sources[0]!.entity).toBeNull();
		expect(record!.sources[0]!.statement).toBe(
			'Aldric Vane keeps the Ledger honest by keeping it afraid.'
		);
	});

	// SPEC.md §7: attribution and the licence are shown on every answer an indexed source
	// appears in, so they are read live rather than frozen when the answer was kept.
	it('reads an indexed source attribution and licence as they are now', async () => {
		const { u, keeper } = await fixture();
		const [corpus] = await db
			.insert(dataSource)
			.values({
				universeId: u.id,
				type: 'wiki',
				name: 'Forgotten Realms Wiki',
				attribution: 'Forgotten Realms Wiki contributors',
				licence: 'CC BY-SA 3.0',
				licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
			})
			.returning();
		if (!corpus) throw new Error('fixture setup failed');

		const row = await keepAnswer(db, {
			...input(u, keeper, ''),
			sources: [
				{
					kind: 'indexed',
					dataSourceId: corpus.id,
					pageTitle: 'Waterdeep',
					url: 'https://forgottenrealms.fandom.com/wiki/Waterdeep',
					statement: 'Waterdeep is governed by the Lords of Waterdeep.'
				}
			]
		});

		await db
			.update(dataSource)
			.set({ licence: 'CC BY-SA 4.0' })
			.where(eq(dataSource.id, corpus.id));

		const record = await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: keeper });
		expect(record!.sources[0]!.dataSource).toEqual({
			id: corpus.id,
			name: 'Forgotten Realms Wiki',
			attribution: 'Forgotten Realms Wiki contributors',
			licence: 'CC BY-SA 4.0',
			licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
		});
		expect(record!.sources[0]!.pageTitle).toBe('Waterdeep');
	});

	it('lists this account own kept answers newest first, and nobody else', async () => {
		const { u, cited, keeper } = await fixture();
		const other = await insertUser(db);
		await keepAnswer(db, { ...input(u, keeper, cited.id), question: 'The older question?' });
		await keepAnswer(db, { ...input(u, keeper, cited.id), question: 'The newer question?' });
		await keepAnswer(db, {
			...input(u, other.id, cited.id),
			question: 'Somebody else question?'
		});

		const mine = await listKeptAnswers(db, { universeId: u.id, keptBy: keeper });
		expect(mine.map((a) => a.question)).toEqual(['The newer question?', 'The older question?']);

		const theirs = await listKeptAnswers(db, { universeId: u.id, keptBy: other.id });
		expect(theirs.map((a) => a.question)).toEqual(['Somebody else question?']);
	});

	it('refuses to read or delete somebody else kept answer', async () => {
		const { u, cited, keeper } = await fixture();
		const other = await insertUser(db);
		const row = await keepAnswer(db, input(u, keeper, cited.id));

		expect(await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: other.id })).toBeNull();
		expect(await deleteKeptAnswer(db, { id: row.id, universeId: u.id, keptBy: other.id })).toBe(
			false
		);
		expect(
			await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: keeper })
		).not.toBeNull();
	});

	// Question 2 of the issue: removing a kept answer means the row is gone, not flagged.
	// Asserted against the tables themselves rather than through the read path, because a
	// soft delete would keep passing a "the list no longer shows it" test.
	it('deletes the row itself, with its sources, leaving nothing behind', async () => {
		const { u, cited, keeper } = await fixture();
		const row = await keepAnswer(db, input(u, keeper, cited.id));

		expect(await deleteKeptAnswer(db, { id: row.id, universeId: u.id, keptBy: keeper })).toBe(true);

		expect(await db.select().from(keptAnswer).where(eq(keptAnswer.id, row.id))).toHaveLength(0);
		expect(
			await db.select().from(keptAnswerSource).where(eq(keptAnswerSource.keptAnswerId, row.id))
		).toHaveLength(0);
		expect(await deleteKeptAnswer(db, { id: row.id, universeId: u.id, keptBy: keeper })).toBe(
			false
		);
	});

	// Guardrail 1, asserted rather than commented: keeping an answer writes a note, and a
	// note is not canon. No revision, no proposal, and the entry the answer cites still says
	// exactly what it said before, even though the answer text differs from its body.
	it('writes no revision and no proposal, and does not touch the entry it cites', async () => {
		const { u, cited, keeper } = await fixture();
		const bodyBefore = cited.body;
		const revisionsBefore = await db.select().from(revision).where(eq(revision.universeId, u.id));
		const proposalsBefore = await db.select().from(proposal).where(eq(proposal.universeId, u.id));

		await keepAnswer(db, input(u, keeper, cited.id));

		expect(await db.select().from(revision).where(eq(revision.universeId, u.id))).toHaveLength(
			revisionsBefore.length
		);
		expect(await db.select().from(proposal).where(eq(proposal.universeId, u.id))).toHaveLength(
			proposalsBefore.length
		);
		const [after] = await db.select().from(entity).where(eq(entity.id, cited.id));
		expect(after!.body).toBe(bodyBefore);
		expect(after!.body).not.toContain('Aldric Vane does, by keeping it afraid.');
	});

	it('refuses a source with no statement to cite', async () => {
		const { u, cited, keeper } = await fixture();
		await expect(
			keepAnswer(db, {
				...input(u, keeper, cited.id),
				sources: [{ kind: 'own_canon', entityId: cited.id, statement: '   ' }]
			})
		).rejects.toThrow(KeptAnswerSourceInvalidError);
	});

	it('refuses an absolute URL where a path belongs', async () => {
		const { u, cited, keeper } = await fixture();
		await expectConstraintViolation(
			keepAnswer(db, {
				...input(u, cited.id, cited.id),
				keptBy: keeper,
				askedFromPath: 'https://evil.invalid/w/valdoria-reach'
			}),
			'kept_answer_asked_from_path_relative'
		);
	});

	it('refuses an own canon citation carrying an indexed page URL', async () => {
		const { u, cited, keeper } = await fixture();
		const row = await keepAnswer(db, input(u, keeper, cited.id));
		await expectConstraintViolation(
			db.insert(keptAnswerSource).values({
				keptAnswerId: row.id,
				rank: 1,
				kind: 'own_canon',
				entityId: cited.id,
				url: 'https://forgottenrealms.fandom.com/wiki/Waterdeep',
				statement: 'A page that does not belong to own canon.'
			}),
			'kept_answer_source_own_canon_shape'
		);
	});

	it('keeps an answer a switched-off universe read without a model', async () => {
		const { u, cited, keeper } = await fixture();
		const row = await keepAnswer(db, {
			...input(u, keeper, cited.id),
			provider: null,
			modelId: null
		});
		const record = await keptAnswerById(db, { id: row.id, universeId: u.id, keptBy: keeper });
		expect(record!.provider).toBeNull();
		expect(record!.modelId).toBeNull();
	});

	// Issue #437, decision T10: every turn is kept automatically now, so a conversation id
	// is what makes the history read as a conversation rather than a pile of loose answers.
	// Two turns asked with the same id group; a third with none of its own (the column's
	// own `defaultRandom()`) stays apart, in a conversation of one.
	it('groups turns sharing a conversation id, and keeps an ungrouped turn apart', async () => {
		const { u, cited, keeper } = await fixture();
		const conversationId = crypto.randomUUID();
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'Who holds the Ashen Ledger to account?'
		});
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'And who does he answer to now?'
		});
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			question: 'A completely unrelated question?'
		});

		const conversations = await listKeptConversations(db, { universeId: u.id, keptBy: keeper });
		expect(conversations).toHaveLength(2);

		const grouped = conversations.find((c) => c.conversationId === conversationId);
		expect(grouped).toBeDefined();
		// Oldest first: the order the conversation actually happened in.
		expect(grouped!.turns.map((t) => t.question)).toEqual([
			'Who holds the Ashen Ledger to account?',
			'And who does he answer to now?'
		]);

		const solo = conversations.find((c) => c.conversationId !== conversationId);
		expect(solo).toBeDefined();
		expect(solo!.turns).toHaveLength(1);
		expect(solo!.turns[0]!.question).toBe('A completely unrelated question?');
	});

	// Issue #531, W3 = B: the record page's search - a case-insensitive substring match
	// against the question or the answer, scoped to rows only (a follow-up that does not
	// match drops out of its conversation the same way an unmatched standalone turn drops
	// out of the list entirely).
	it('filters conversations by a case-insensitive substring match on question or answer', async () => {
		const { u, cited, keeper } = await fixture();
		const conversationId = crypto.randomUUID();
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'Who holds the Ashen Ledger to account?',
			answer: 'Aldric Vane does, by keeping it afraid.'
		});
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'What does the dragon want with the harbour?',
			answer: 'Nobody has asked it yet.'
		});
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			question: 'Where is the Sunken Library?',
			answer: 'Beneath the tide pools east of Vasa.'
		});

		const byQuestion = await listKeptConversations(db, {
			universeId: u.id,
			keptBy: keeper,
			query: 'dragon'
		});
		expect(byQuestion).toHaveLength(1);
		expect(byQuestion[0]!.turns.map((t) => t.question)).toEqual([
			'What does the dragon want with the harbour?'
		]);

		// Matches the answer text too, case-insensitively, and unrelated casing.
		const byAnswer = await listKeptConversations(db, {
			universeId: u.id,
			keptBy: keeper,
			query: 'TIDE POOLS'
		});
		expect(byAnswer).toHaveLength(1);
		expect(byAnswer[0]!.turns[0]!.question).toBe('Where is the Sunken Library?');

		// No hits at all: an empty result, not an error.
		expect(
			await listKeptConversations(db, { universeId: u.id, keptBy: keeper, query: 'kraken' })
		).toEqual([]);

		// Whitespace-only is the same as no query.
		const unfiltered = await listKeptConversations(db, {
			universeId: u.id,
			keptBy: keeper,
			query: '   '
		});
		expect(unfiltered).toHaveLength(2);
	});

	// Issue #455, decision U11: the read `/w/[universe]/ask/[conversationId]` needs -
	// oldest first, the order the conversation actually happened in, with each turn's own
	// sources resolved exactly like every other read in this module.
	it('reads one conversation by id, oldest first, with sources', async () => {
		const { u, cited, keeper } = await fixture();
		const conversationId = crypto.randomUUID();
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'Who holds the Ashen Ledger to account?'
		});
		await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'And who does he answer to now?'
		});
		// A different conversation, sharing neither id nor account, must not leak in.
		await keepAnswer(db, input(u, keeper, cited.id));

		const conversation = await getKeptConversation(db, {
			conversationId,
			universeId: u.id,
			keptBy: keeper
		});
		expect(conversation).not.toBeNull();
		expect(conversation!.conversationId).toBe(conversationId);
		expect(conversation!.turns.map((t) => t.question)).toEqual([
			'Who holds the Ashen Ledger to account?',
			'And who does he answer to now?'
		]);
		expect(conversation!.turns[0]!.sources[0]!.entity).toEqual({
			id: cited.id,
			name: 'Aldric Vane',
			slug: cited.slug,
			type: 'character'
		});
	});

	// Null for a wrong id and for somebody else's conversation, identically - the same
	// "a probe cannot tell them apart" shape `keptAnswerById` already gives a single turn.
	it('returns null for a wrong id and for somebody else conversation', async () => {
		const { u, cited, keeper } = await fixture();
		const other = await insertUser(db);
		const conversationId = crypto.randomUUID();
		await keepAnswer(db, { ...input(u, keeper, cited.id), conversationId });

		expect(
			await getKeptConversation(db, {
				conversationId: crypto.randomUUID(),
				universeId: u.id,
				keptBy: keeper
			})
		).toBeNull();
		expect(
			await getKeptConversation(db, { conversationId, universeId: u.id, keptBy: other.id })
		).toBeNull();
	});

	// The new capability the issue actually asks for: discarding a conversation discards
	// every turn it holds and every source those turns cited, and leaves an unrelated
	// conversation untouched.
	it('deletes every turn and its sources when a conversation is deleted, leaving another alone', async () => {
		const { u, cited, keeper } = await fixture();
		const conversationId = crypto.randomUUID();
		const first = await keepAnswer(db, { ...input(u, keeper, cited.id), conversationId });
		const second = await keepAnswer(db, {
			...input(u, keeper, cited.id),
			conversationId,
			question: 'A second turn in the same conversation?'
		});
		const other = await keepAnswer(db, input(u, keeper, cited.id));

		expect(
			await deleteKeptConversation(db, { conversationId, universeId: u.id, keptBy: keeper })
		).toBe(true);

		expect(await db.select().from(keptAnswer).where(eq(keptAnswer.id, first.id))).toHaveLength(0);
		expect(await db.select().from(keptAnswer).where(eq(keptAnswer.id, second.id))).toHaveLength(0);
		expect(
			await db.select().from(keptAnswerSource).where(eq(keptAnswerSource.keptAnswerId, first.id))
		).toHaveLength(0);
		expect(
			await db.select().from(keptAnswerSource).where(eq(keptAnswerSource.keptAnswerId, second.id))
		).toHaveLength(0);

		// The other conversation, sharing neither id, is untouched.
		expect(await db.select().from(keptAnswer).where(eq(keptAnswer.id, other.id))).toHaveLength(1);

		expect(
			await deleteKeptConversation(db, { conversationId, universeId: u.id, keptBy: keeper })
		).toBe(false);
	});

	it('refuses to delete somebody else conversation', async () => {
		const { u, cited, keeper } = await fixture();
		const other = await insertUser(db);
		const conversationId = crypto.randomUUID();
		const row = await keepAnswer(db, { ...input(u, keeper, cited.id), conversationId });

		expect(
			await deleteKeptConversation(db, { conversationId, universeId: u.id, keptBy: other.id })
		).toBe(false);
		expect(await db.select().from(keptAnswer).where(eq(keptAnswer.id, row.id))).toHaveLength(1);
	});
});
