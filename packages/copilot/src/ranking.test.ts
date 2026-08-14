import { closeDb, eq, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import type { RoutedModel } from './models.js';
import { writePlanRationale } from './ranking.js';
import { insertHomebrewUniverse, insertUser } from './test-helpers.js';
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
		modelId: 'test-cheap',
		doGenerate: {
			content: [{ type: 'text', text: JSON.stringify(object) }],
			finishReason: { unified: 'stop', raw: undefined },
			usage: usage(50, 20),
			warnings: []
		}
	}) as unknown as LanguageModel;
}

const RESOLVED: ResolvedModel = {
	purpose: 'cheap',
	provider: 'test-provider',
	modelId: 'test-cheap',
	params: {}
};

function routed(languageModel: LanguageModel): RoutedModel {
	return { languageModel, resolved: RESOLVED };
}

describe('writePlanRationale', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('returns an empty plan and charges nothing when there are no candidates', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });

		const result = await writePlanRationale({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityName: 'Aldric Vane',
			diff: [],
			candidates: [],
			model: routed(scriptedModel({}))
		});

		expect(result.candidates).toEqual([]);
		expect(result.credits).toBe(0);
	});

	it('writes a rationale per candidate and charges propagate.plan through withQuota', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const model = scriptedModel({
			summary: 'This touches 2 entries.',
			candidates: [
				{ entityId: 'iselde-wrenn', rationale: 'She appointed him.' },
				{ entityId: 'the-ashen-ledger', rationale: 'They employ him.' }
			]
		});

		const result = await writePlanRationale({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityName: 'Aldric Vane',
			diff: [{ kind: 'added', statement: 'Iselde is reviewing his appointment.' }],
			candidates: [
				{ entityId: 'iselde-wrenn', name: 'Iselde Wrenn' },
				{ entityId: 'the-ashen-ledger', name: 'The Ashen Ledger' }
			],
			model: routed(model)
		});

		expect(result.summary).toBe('This touches 2 entries.');
		expect(result.candidates).toEqual([
			{ entityId: 'iselde-wrenn', rationale: 'She appointed him.' },
			{ entityId: 'the-ashen-ledger', rationale: 'They employ him.' }
		]);
		expect(result.credits).toBeGreaterThan(0);

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, 'propagate.plan'));
		const matching = calls.filter((c) => c.userId === owner.id);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.agent).toBe('propagate');
		expect(matching[0]?.credits).toBeGreaterThan(0);
		expect(matching[0]?.inputTokens).toBe(50);
		expect(matching[0]?.outputTokens).toBe(20);
	});

	it('drops a candidate the model omits and never invents one outside the shortlist', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		// The model only writes a rationale for one of the two offered candidates - the
		// schema's entityId enum would reject an invented id outright, so this only tests
		// the "the model may narrow, never widen" half.
		const model = scriptedModel({
			summary: 'Only one entry really matters here.',
			candidates: [{ entityId: 'iselde-wrenn', rationale: 'She appointed him.' }]
		});

		const result = await writePlanRationale({
			db,
			userId: owner.id,
			universeId: universe.id,
			editedEntityName: 'Aldric Vane',
			diff: [{ kind: 'added', statement: 'Iselde is reviewing his appointment.' }],
			candidates: [
				{ entityId: 'iselde-wrenn', name: 'Iselde Wrenn' },
				{ entityId: 'the-ashen-ledger', name: 'The Ashen Ledger' }
			],
			model: routed(model)
		});

		expect(result.candidates).toEqual([
			{ entityId: 'iselde-wrenn', rationale: 'She appointed him.' }
		]);
	});
});
