/**
 * Integration test for Complete (issue #54, SPEC.md §5) against the real database with a
 * fake model: proposes missing content for a deliberately thin entry and lands it as a
 * normal pending `update` proposal, so it goes through the same accept flow as any other.
 */
import { and, closeDb, eq, isNull, upsertUniverseNarrationStyle, type Db } from '@canonry/db';
import { modelCall, proposalPlan, relationType } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import { AiDisabledError } from './propagate.js';
import { completeEntry } from './complete.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import {
	insertEntity,
	insertHomebrewUniverse,
	insertModelConfig,
	insertRelation,
	insertRelationType,
	insertUser,
	systemPromptOf,
	userPromptOf
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

/** Like `scriptedModel`, but hands the real call `options` to `capture` first - for
 * asserting on "the prompt actually sent" (SPEC.md §17, issues #123/#124) rather than
 * only on the object that comes back. */
function capturingScriptedModel(
	object: unknown,
	capture: (options: { prompt: Array<{ role: string; content: unknown }> }) => void
): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-premium',
		doGenerate: async (options) => {
			capture(options);
			return {
				content: [{ type: 'text', text: JSON.stringify(object) }],
				finishReason: { unified: 'stop', raw: undefined },
				usage: usage(150, 100),
				warnings: []
			};
		}
	}) as unknown as LanguageModel;
}

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

function modelFactoryFor(model: LanguageModel): ModelFactory {
	return (_resolved: ResolvedModel) => model;
}

describe('completeEntry (issue #54, SPEC.md §5)', () => {
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

	it('proposes missing content for a thin entry, with evidence from its own relation, as a pending update proposal', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const ledger = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: ''
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'employs',
			inverseLabel: 'employed by'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: ledger.id,
			toEntityId: thin.id
		});

		const draftedBody = 'A factor of the Ashen Ledger, collecting on its behalf.';
		const model = scriptedModel({ summary: 'Notes his employer.', after: draftedBody });

		const result = await completeEntry({
			db,
			userId: owner.id,
			universeId: universe.id,
			entityId: thin.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		expect(result.proposal.trigger).toBe('complete');
		expect(result.proposal.kind).toBe('update');
		expect(result.proposal.outcome).toBe('pending');
		expect(result.proposal.targetEntityId).toBe(thin.id);
		expect(result.proposal.patch).toEqual({
			summary: 'Notes his employer.',
			before: '',
			after: draftedBody
		});
		expect(result.evidence).toContainEqual({ kind: 'relation', hops: 1, path: ['employs'] });
		expect(result.proposal.credits).toBeGreaterThan(0);

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, 'entry.complete'));
		const matching = calls.filter((c) => c.userId === owner.id);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.agent).toBe('loremaster');

		// Issue #345: the diff is written here and now, so the plan it belongs to is spent and
		// says so. Left at `ready` the review surfaces offer C3's "Generate diffs" for a
		// candidate that already has its prose, which is two clicks and a round trip in front
		// of every completion.
		const [plan] = await db
			.select()
			.from(proposalPlan)
			.where(eq(proposalPlan.id, result.proposal.planId ?? ''));
		expect(plan?.status).toBe('spent');
	});

	it('issue #559: a mention sentence quoted as completion evidence never carries a :::secret marker', async () => {
		// The other entity's body is shaped the way a GM writes one: a fence closes and the
		// next sentence starts on the line after the marker. Completion scans that body for
		// mentions of the thin entry, and the sentence it finds becomes evidence in the
		// prompt and in the proposal a GM reads. Split without knowing about the fence, the
		// marker line joins the paragraph beside it and the evidence is markup glued to
		// prose, a sentence nobody wrote quoted back as if somebody had.
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: ''
		});
		await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Mother Sennah',
			body: 'Keeps the house.\n\n:::secret\nShe was a fence for years.\n:::\nShe still pays [[Corvin Ashe]] every week.'
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const result = await completeEntry({
			db,
			userId: owner.id,
			universeId: universe.id,
			entityId: thin.id,
			locale: 'en',
			modelFactory: modelFactoryFor(
				capturingScriptedModel({ summary: 's', after: 'a' }, (options) => {
					captured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const mentions = result.evidence.filter(
			(e): e is Extract<typeof e, { kind: 'mention' }> => e.kind === 'mention'
		);
		expect(mentions.length).toBeGreaterThan(0);
		for (const evidence of mentions) {
			expect(evidence.sourceSentence).not.toContain(':::');
		}
		expect(mentions.map((e) => e.sourceSentence)).toContain(
			'She still pays [[Corvin Ashe]] every week.'
		);

		// And the prompt the model actually saw carries the same clean sentence, since that
		// is the copy the drafted body is written from.
		expect(userPromptOf(captured!)).not.toContain(':::');
	});

	it('refuses to run when the universe has generation switched off (guardrail 4)', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id, aiEnabled: false });
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Unnamed',
			body: ''
		});

		await expect(
			completeEntry({
				db,
				userId: owner.id,
				universeId: universe.id,
				entityId: thin.id,
				locale: 'en',
				modelFactory: modelFactoryFor(scriptedModel({ summary: 's', after: 'a' })),
				gateway: IDENTITY_GATEWAY
			})
		).rejects.toBeInstanceOf(AiDisabledError);
	});

	it('SPEC.md §17 rules two and three (issues #123/#124): an Italian-locale GM completing an English (undetermined-language) thin entry gets an Italian summary but an English drafted body', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const ledger = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		// No `language` recorded and an empty body: canonLanguageFor has nothing to detect
		// from and no trigger entity exists for Complete, so it falls all the way to its
		// last, English default - deliberately never to the reader's Italian locale.
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: ''
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'employs',
			inverseLabel: 'employed by'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: ledger.id,
			toEntityId: thin.id
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const draftedBody = 'A factor of the Ashen Ledger, collecting on its behalf.';
		const model = capturingScriptedModel(
			{ summary: 'Annota il suo datore di lavoro.', after: draftedBody },
			(options) => {
				captured = options;
			}
		);

		const result = await completeEntry({
			db,
			userId: owner.id,
			universeId: universe.id,
			entityId: thin.id,
			locale: 'it',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain('Italiano');
		expect(system).toContain('locale "it"');
		expect(system).toContain('content language "en"');
		expect(system).toContain('never translate a proper noun');
		expect(system).toContain('never translate a quoted sentence');

		expect(result.proposal.rationale).toBe('Annota il suo datore di lavoro.');
		expect(result.proposal.patch).toEqual({
			summary: 'Annota il suo datore di lavoro.',
			before: '',
			after: draftedBody
		});
	});

	it('issue #378, decision R3, amended by issue #451, decision U2: a custom Loremaster voice reaches the completion system prompt beside speechInstruction, and no voice chosen adds no clause', async () => {
		const owner = await insertUser(db);
		const voice = 'Formal, archival, never a wasted word.';
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		await upsertUniverseNarrationStyle(db, {
			universeId: universe.id,
			name: 'Custom',
			promptClause: voice
		});
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: ''
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await completeEntry({
			db,
			userId: owner.id,
			universeId: universe.id,
			entityId: thin.id,
			locale: 'en',
			modelFactory: modelFactoryFor(
				capturingScriptedModel({ summary: 's', after: 'a' }, (options) => {
					captured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain(voice);
		expect(system).toContain('how their Loremaster sounds');
		expect(system).toContain('Let it shape your tone and word choice only');

		// A universe with no voice chosen (`narrationStyleId` null, the fixture's own
		// default) gets no clause at all, not an empty one.
		const silentOwner = await insertUser(db);
		const silentUniverse = await insertHomebrewUniverse(db, { ownerUserId: silentOwner.id });
		const silentThin = await insertEntity(db, silentUniverse.id, {
			type: 'character',
			name: 'Unnamed',
			body: ''
		});
		let silentCaptured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		await completeEntry({
			db,
			userId: silentOwner.id,
			universeId: silentUniverse.id,
			entityId: silentThin.id,
			locale: 'en',
			modelFactory: modelFactoryFor(
				capturingScriptedModel({ summary: 's', after: 'a' }, (options) => {
					silentCaptured = options;
				})
			),
			gateway: IDENTITY_GATEWAY
		});

		const silentSystem = systemPromptOf(silentCaptured!);
		expect(silentSystem).not.toContain('how their Loremaster sounds');
		expect(silentSystem).not.toContain('Let it shape your tone');
	});

	it("issue #197: an Italian-locale GM's completion prompt carries the shipped relation's Italian label, not its English key", async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const ledger = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: ''
		});
		// The *shipped* "employs" type (no `insertRelationType` call) - `relationEvidence`
		// carries its key, "employs", and the prompt has to render that key as "impiega"
		// (its Italian catalogue label) for an Italian-locale caller.
		const [shippedEmploys] = await db
			.select()
			.from(relationType)
			.where(and(isNull(relationType.universeId), eq(relationType.key, 'employs')));
		if (!shippedEmploys) throw new Error('shipped "employs" relation type not seeded');
		await insertRelation(db, universe.id, {
			relationTypeId: shippedEmploys.id,
			fromEntityId: ledger.id,
			toEntityId: thin.id
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const model = capturingScriptedModel(
			{ summary: 'Annota il suo datore di lavoro.', after: 'A factor.' },
			(options) => {
				captured = options;
			}
		);

		await completeEntry({
			db,
			userId: owner.id,
			universeId: universe.id,
			entityId: thin.id,
			locale: 'it',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		const user = userPromptOf(captured!);
		expect(user).toContain('relation: impiega');
		expect(user).not.toContain('relation: employs');
	});

	it('and the reverse: an English-locale GM completing an entry recorded as Italian gets an English summary but an Italian drafted body', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const ledger = await insertEntity(db, universe.id, {
			type: 'faction',
			name: 'The Ashen Ledger',
			body: 'A merchant bank.'
		});
		const thin = await insertEntity(db, universe.id, {
			type: 'character',
			name: 'Corvin Ashe',
			body: '',
			// entity.language recorded directly (the GM overrode it, or a prior save
			// detected it) - canonLanguageFor's first and strongest signal.
			language: 'it'
		});
		const rt = await insertRelationType(db, universe.id, {
			label: 'employs',
			inverseLabel: 'employed by'
		});
		await insertRelation(db, universe.id, {
			relationTypeId: rt.id,
			fromEntityId: ledger.id,
			toEntityId: thin.id
		});

		let captured: { prompt: Array<{ role: string; content: unknown }> } | undefined;
		const draftedBody = 'Un fattore della Ashen Ledger, che riscuote per suo conto.';
		const model = capturingScriptedModel(
			{ summary: 'Notes his employer.', after: draftedBody },
			(options) => {
				captured = options;
			}
		);

		const result = await completeEntry({
			db,
			userId: owner.id,
			universeId: universe.id,
			entityId: thin.id,
			locale: 'en',
			modelFactory: modelFactoryFor(model),
			gateway: IDENTITY_GATEWAY
		});

		const system = systemPromptOf(captured!);
		expect(system).toContain('locale "en"');
		expect(system).toContain('content language "it"');

		expect(result.proposal.rationale).toBe('Notes his employer.');
		expect(result.proposal.patch).toEqual({
			summary: 'Notes his employer.',
			before: '',
			after: draftedBody
		});
	});
});
