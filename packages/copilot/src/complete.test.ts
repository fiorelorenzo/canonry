/**
 * Integration test for Complete (issue #54, SPEC.md §5) against the real database with a
 * fake model: proposes missing content for a deliberately thin entry and lands it as a
 * normal pending `update` proposal, so it goes through the same accept flow as any other.
 */
import { closeDb, eq, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
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
	systemPromptOf
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
