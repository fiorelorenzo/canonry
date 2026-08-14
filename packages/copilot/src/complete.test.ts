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
				modelFactory: modelFactoryFor(scriptedModel({ summary: 's', after: 'a' })),
				gateway: IDENTITY_GATEWAY
			})
		).rejects.toBeInstanceOf(AiDisabledError);
	});
});
