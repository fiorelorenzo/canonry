/**
 * Integration tests for Ask's two propose tools (issue #256, SPEC.md §5's Ask row):
 * `entryPropose` and `entryEditPropose` against the real database with a fake premium
 * model. Guardrail 1 is the point of this issue, not a constraint on it, so every test
 * here that succeeds also asserts the `revision` table stayed empty - `acceptProposal`
 * is the only code allowed to write one, and this file proves neither tool bypasses it.
 */
import { and, closeDb, eq, type Db } from '@canonry/db';
import { acceptProposal, rejectProposal } from '@canonry/db';
import { entity, modelCall, proposal, proposalPlan, revision } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import { AiDisabledError } from './propagate.js';
import { entryEditPropose, entryPropose } from './ask-propose.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertUser
} from './test-helpers.js';
import { openTestDb } from './test-db.js';

function usage(inputTotal: number, outputTotal: number) {
	return {
		inputTokens: {
			total: inputTotal,
			noCache: inputTotal,
			cacheRead: undefined,
			cacheWrite: undefined
		},
		outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined }
	};
}

function scriptedModel(object: unknown): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doGenerate: async () => ({
			content: [{ type: 'text', text: JSON.stringify(object) }],
			finishReason: { unified: 'stop', raw: undefined },
			usage: usage(150, 100),
			warnings: []
		})
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(model: LanguageModel): ModelFactory {
	return (_resolved: ResolvedModel) => model;
}

async function revisionCount(db: Db, universeId: string): Promise<number> {
	const rows = await db.select().from(revision).where(eq(revision.universeId, universeId));
	return rows.length;
}

describe('entryPropose / entryEditPropose (issue #256, guardrail 1)', () => {
	let db: Db;

	beforeAll(async () => {
		db = openTestDb();
		try {
			await insertModelConfig(db, 'premium');
		} catch {
			/* another file in this run already provided one */
		}
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('entry_propose creates exactly one pending draft_entity proposal and zero revisions', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const mother = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Mother Sennah',
			body: 'Runs the harbour stables and keeps every ledger by hand.'
		});

		const model = scriptedModel({
			type: 'character',
			name: "Sennah's nephew",
			aliases: [],
			body: 'Works the stables under his aunt, Mother Sennah.',
			summary: "A new entry for Mother Sennah's nephew, who runs the stables.",
			usedSources: [1]
		});

		const result = await entryPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [
				{
					entityId: mother.id,
					entityName: mother.name,
					statement: 'Runs the harbour stables and keeps every ledger by hand.',
					score: 0.7
				}
			],
			request: "Create a card for Mother Sennah's nephew, he runs the stables.",
			name: "Sennah's nephew",
			instruction: 'He runs the stables.'
		});

		expect(result.kind).toBe('draft_entity');
		expect(result.redirected).toBe(false);
		expect(result.proposal.outcome).toBe('pending');
		expect(result.proposal.targetEntityId).toBeNull();
		expect(result.proposal.patch).toEqual({
			type: 'character',
			name: "Sennah's nephew",
			slug: 'sennah-s-nephew',
			aliases: [],
			body: 'Works the stables under his aunt, Mother Sennah.'
		});
		// issue #270: the GM's own request comes first, because that is what produced this
		// draft, and it is quoted verbatim rather than paraphrased by the model.
		expect(result.evidence[0]).toEqual({
			kind: 'instruction',
			instruction: "Create a card for Mother Sennah's nephew, he runs the stables."
		});
		// Mother Sennah's own sentence survives both gates: the model named it, and the GM's
		// request names her.
		expect(result.evidence).toContainEqual({
			kind: 'embedding',
			similarity: 0.7,
			sourceSentence: 'Runs the harbour stables and keeps every ledger by hand.'
		});
		// issue #270: real canon evidence was attached, so the rationale carries no "nothing
		// backs this" disclaimer.
		expect(result.proposal.rationale).not.toContain('own instruction');

		const pending = await db
			.select()
			.from(proposal)
			.where(and(eq(proposal.universeId, universe.id), eq(proposal.kind, 'draft_entity')));
		expect(pending).toHaveLength(1);
		expect(pending[0]?.id).toBe(result.proposal.id);
		// issue #270: Ask has its own trigger value (migration 0040). 'table' made this
		// indistinguishable from a quick action fired mid-session.
		expect(pending[0]?.trigger).toBe('ask');

		// issue #270: a create never claims Mother Sennah's own edit produced it, even
		// though she is the strongest evidence source - the plan's own `triggerEntityId`
		// stays null, which is what keeps the inbox from reading "From: editing Mother
		// Sennah" for an entry nobody edited.
		const [plan] = await db
			.select()
			.from(proposalPlan)
			.where(eq(proposalPlan.id, result.proposal.planId!));
		expect(plan?.triggerEntityId).toBeNull();

		// Guardrail 1: no revision exists until a human accepts this proposal.
		expect(await revisionCount(db, universe.id)).toBe(0);

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, 'entry.complete'));
		expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(1);
	});

	it('issue #270: retrieved sources the drafting model did not actually rely on never become evidence, and the rationale says so', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const merchants = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'Casa dei Mercanti',
			body: 'Ogni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa.'
		});

		// Ask's own retrieval offers this as a weak, coincidental word-overlap match
		// (Main's real #270 report: similarity 0.105 against an unrelated bookkeeping
		// sentence) - the model is handed it as candidate [1] but does not name it in
		// `usedSources`, which is what an honest reading of a genuinely irrelevant match
		// looks like.
		const model = scriptedModel({
			type: 'character',
			name: 'Tobin Sennah',
			aliases: [],
			body: 'Works the stables for his aunt.',
			summary: 'A new entry for Tobin Sennah, a stable boy.',
			usedSources: []
		});

		const result = await entryPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [
				{
					entityId: merchants.id,
					entityName: merchants.name,
					statement: merchants.body,
					score: 0.105
				}
			],
			request: 'Create a card for Tobin Sennah, a stable boy.',
			name: 'Tobin Sennah',
			instruction: 'He runs the stables.'
		});

		// No canon evidence attached - a 0.105-similarity, off-topic sentence is not a
		// citation just because it was retrieved. What is attached is the GM's own request,
		// which is the one thing that is actually true of this draft.
		expect(result.evidence).toEqual([
			{ kind: 'instruction', instruction: 'Create a card for Tobin Sennah, a stable boy.' }
		]);
		expect(result.proposal.evidence).toEqual([
			{ kind: 'instruction', instruction: 'Create a card for Tobin Sennah, a stable boy.' }
		]);

		// The rationale says plainly that nothing in canon backs this, in the GM's own
		// locale, rather than leaving an empty evidence popover to speak for itself.
		expect(result.proposal.rationale).toBe(
			'A new entry for Tobin Sennah, a stable boy. Drafted from your own instruction, not from existing canon.'
		);

		// The plan never claims the Casa dei Mercanti's own entry produced this one.
		const [plan] = await db
			.select()
			.from(proposalPlan)
			.where(eq(proposalPlan.id, result.proposal.planId!));
		expect(plan?.triggerEntityId).toBeNull();
	});

	it('issue #270: a retrieved sentence the model does claim to have used is still dropped when its own entry is named nowhere', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const merchants = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'Casa dei Mercanti',
			body: 'Ogni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa.'
		});

		// The failure mode a self-reported `usedSources` cannot catch on its own: the model
		// names candidate [1] even though the bookkeeping rule has nothing to do with a
		// stable boy. No similarity floor can separate this from a real citation either -
		// Main's #270 report had 0.105, 0.103 and 0.067 for three sentences, one of them
		// genuine. What separates them is that this entry is named neither by the GM's
		// request nor by the draft.
		const model = scriptedModel({
			type: 'character',
			name: 'Tobin Sennah',
			aliases: [],
			body: 'Works the stables for his aunt.',
			summary: 'A new entry for Tobin Sennah, a stable boy.',
			usedSources: [1]
		});

		const result = await entryPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [
				{
					entityId: merchants.id,
					entityName: merchants.name,
					statement: merchants.body,
					score: 0.103
				}
			],
			request: 'Create a card for Tobin Sennah, a stable boy.',
			name: 'Tobin Sennah',
			instruction: 'He runs the stables.'
		});

		expect(result.evidence).toEqual([
			{ kind: 'instruction', instruction: 'Create a card for Tobin Sennah, a stable boy.' }
		]);
		expect(result.proposal.rationale).toBe(
			'A new entry for Tobin Sennah, a stable boy. Drafted from your own instruction, not from existing canon.'
		);
	});

	it('entry_edit_propose against a real entity creates one pending update proposal and zero revisions', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const cairnmouth = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town built on stilts over the tide flats.'
		});

		const draftedBody =
			'A fishing town built on stilts over the tide flats. The harbour freezes solid every winter.';
		const model = scriptedModel({
			summary: 'Notes that the harbour freezes in winter.',
			after: draftedBody,
			usedSources: []
		});

		const result = await entryEditPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [],
			request: 'Add to Cairnmouth that the harbour freezes in winter.',
			entityName: 'Cairnmouth',
			instruction: 'The harbour freezes in winter.'
		});

		expect(result.kind).toBe('update');
		expect(result.redirected).toBe(false);
		expect(result.proposal.outcome).toBe('pending');
		expect(result.proposal.targetEntityId).toBe(cairnmouth.id);
		expect(result.proposal.patch).toEqual({
			summary: 'Notes that the harbour freezes in winter.',
			before: 'A fishing town built on stilts over the tide flats.',
			after: draftedBody
		});
		// issue #270: an Ask-originated edit records `ask` too, and carries the GM's own
		// request as its evidence. `trigger_entity` is honestly Cairnmouth here, and the
		// trigger is what stops the provenance line reading "editing Cairnmouth" for an edit
		// the GM never made by hand.
		expect(result.proposal.trigger).toBe('ask');
		expect(result.evidence).toEqual([
			{ kind: 'instruction', instruction: 'Add to Cairnmouth that the harbour freezes in winter.' }
		]);
		const [plan] = await db
			.select()
			.from(proposalPlan)
			.where(eq(proposalPlan.id, result.proposal.planId!));
		expect(plan?.trigger).toBe('ask');
		expect(plan?.triggerEntityId).toBe(cairnmouth.id);

		const [entityRow] = await db.select().from(entity).where(eq(entity.id, cairnmouth.id));
		expect(entityRow?.body).toBe('A fishing town built on stilts over the tide flats.');
		expect(await revisionCount(db, universe.id)).toBe(0);

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, 'propagate.diff'));
		expect(calls.filter((c) => c.userId === owner.id)).toHaveLength(1);
	});

	it('accepting a proposal from either tool through acceptProposal produces a revision with author_kind "ai_accepted"', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const cairnmouth = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town.'
		});

		const model = scriptedModel({
			summary: 'Adds the winter freeze.',
			after: 'A fishing town. Freezes in winter.',
			usedSources: []
		});
		const result = await entryEditPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [],
			request: 'Add to Cairnmouth that it freezes in winter.',
			entityName: 'Cairnmouth',
			instruction: 'It freezes in winter.'
		});

		const accepted = await acceptProposal(db, {
			proposalId: result.proposal.id,
			decidedBy: owner.id
		});
		expect(accepted.outcome).toBe('accepted');
		expect(accepted.appliedRevisionId).not.toBeNull();

		const [rev] = await db
			.select()
			.from(revision)
			.where(eq(revision.id, accepted.appliedRevisionId!));
		expect(rev?.authorKind).toBe('ai_accepted');
		expect(rev?.entityId).toBe(cairnmouth.id);
		expect(rev?.proposalId).toBe(result.proposal.id);
		expect(rev?.body).toBe('A fishing town. Freezes in winter.');

		const [entityRow] = await db.select().from(entity).where(eq(entity.id, cairnmouth.id));
		expect(entityRow?.body).toBe('A fishing town. Freezes in winter.');
	});

	it('rejecting a proposal from either tool changes nothing', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const cairnmouth = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town.'
		});

		const model = scriptedModel({
			summary: 'Adds the winter freeze.',
			after: 'A fishing town. Freezes.',
			usedSources: []
		});
		const result = await entryEditPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [],
			request: 'Add to Cairnmouth that it freezes.',
			entityName: 'Cairnmouth',
			instruction: 'It freezes.'
		});

		const rejected = await rejectProposal(db, {
			proposalId: result.proposal.id,
			reason: 'not_useful'
		});
		expect(rejected.outcome).toBe('rejected');
		expect(rejected.appliedRevisionId).toBeNull();

		const [entityRow] = await db.select().from(entity).where(eq(entity.id, cairnmouth.id));
		expect(entityRow?.body).toBe('A fishing town.');
		expect(await revisionCount(db, universe.id)).toBe(0);
	});

	it('refuses when the universe has generation switched off (guardrail 4)', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id, aiEnabled: false });
		await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town.'
		});

		await expect(
			entryPropose({
				db,
				userId: owner.id,
				universeId: universe.id,
				locale: 'en',
				modelFactory: modelFactoryFor(scriptedModel({})),
				gateway: IDENTITY_GATEWAY,
				sources: [],
				request: 'Create a card for anyone.',
				name: 'Anyone',
				instruction: 'Anything.'
			})
		).rejects.toBeInstanceOf(AiDisabledError);

		await expect(
			entryEditPropose({
				db,
				userId: owner.id,
				universeId: universe.id,
				locale: 'en',
				modelFactory: modelFactoryFor(scriptedModel({})),
				gateway: IDENTITY_GATEWAY,
				sources: [],
				request: 'Add anything to Cairnmouth.',
				entityName: 'Cairnmouth',
				instruction: 'Anything.'
			})
		).rejects.toBeInstanceOf(AiDisabledError);
	});

	it('an edit aimed at a nonexistent entry proposes a creation rather than editing something else (guardrail 6)', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const unrelated = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town.'
		});

		const model = scriptedModel({
			type: 'character',
			name: 'Mother Sennah',
			aliases: [],
			body: 'Runs the stables.',
			summary: 'A new entry for Mother Sennah.',
			usedSources: []
		});

		const result = await entryEditPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [],
			request: 'Add to Mother Sennah that she runs the stables.',
			entityName: 'Mother Sennah',
			instruction: 'She runs the stables.'
		});

		expect(result.redirected).toBe(true);
		expect(result.kind).toBe('draft_entity');
		expect(result.proposal.targetEntityId).toBeNull();
		expect(result.proposal.patch).toMatchObject({ name: 'Mother Sennah' });

		// The unrelated existing entity was never touched.
		const [entityRow] = await db.select().from(entity).where(eq(entity.id, unrelated.id));
		expect(entityRow?.body).toBe('A fishing town.');
		const unrelatedUpdateProposals = await db
			.select()
			.from(proposal)
			.where(and(eq(proposal.universeId, universe.id), eq(proposal.targetEntityId, unrelated.id)));
		expect(unrelatedUpdateProposals).toHaveLength(0);
		expect(await revisionCount(db, universe.id)).toBe(0);
	});

	it('a create aimed at an existing entry proposes an edit rather than a second entry (guardrail 6)', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const cairnmouth = await insertEntity(db, universe.id, {
			type: 'place',
			name: 'Cairnmouth',
			body: 'A fishing town.'
		});

		const model = scriptedModel({
			summary: 'Adds the market square.',
			after: 'A fishing town. It has a market square.',
			usedSources: []
		});

		const result = await entryPropose({
			db,
			userId: owner.id,
			universeId: universe.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY,
			sources: [],
			request: 'Create a card for Cairnmouth with its market square.',
			name: 'Cairnmouth',
			instruction: 'It has a market square.'
		});

		expect(result.redirected).toBe(true);
		expect(result.kind).toBe('update');
		expect(result.proposal.targetEntityId).toBe(cairnmouth.id);

		const createProposals = await db
			.select()
			.from(proposal)
			.where(and(eq(proposal.universeId, universe.id), eq(proposal.kind, 'draft_entity')));
		expect(createProposals).toHaveLength(0);
	});
});
