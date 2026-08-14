import { closeDb, eq, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from '@canonry/ai';
import type { CandidateEvidence } from './candidates.js';
import { writeEntityDiff } from './diffs.js';
import type { RoutedModel } from './models.js';
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
		modelId: 'test-premium',
		doGenerate: {
			content: [{ type: 'text', text: JSON.stringify(object) }],
			finishReason: { unified: 'stop', raw: undefined },
			usage: usage(200, 150),
			warnings: []
		}
	}) as unknown as LanguageModel;
}

const RESOLVED: ResolvedModel = {
	purpose: 'premium',
	provider: 'test-provider',
	modelId: 'test-premium',
	params: { eurPerInputMTok: 5, eurPerOutputMTok: 15 }
};

function routed(languageModel: LanguageModel): RoutedModel {
	return { languageModel, resolved: RESOLVED };
}

describe('writeEntityDiff', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('drafts a full new body, charges propagate.diff, and snapshots the current body as "before"', async () => {
		const owner = await insertUser(db);
		const universe = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const currentBody = 'A merchant bank that lends at knife point.';
		const proposedBody = `${currentBody} It now employs a dismissed watch captain.`;

		const evidence: CandidateEvidence[] = [
			{ kind: 'relation', hops: 1, path: ['employs'] },
			{
				kind: 'mention',
				direction: 'forward',
				matchedText: 'The Ashen Ledger',
				sourceSentence: 'He now answers to [[The Ashen Ledger]].'
			}
		];

		const model = scriptedModel({
			summary: 'Notes that the Ledger now employs Aldric.',
			after: proposedBody
		});

		const result = await writeEntityDiff({
			db,
			userId: owner.id,
			universeId: universe.id,
			targetEntityName: 'The Ashen Ledger',
			targetEntityBody: currentBody,
			planRationale: 'They employ him.',
			evidence,
			editedEntityName: 'Aldric Vane',
			diff: [{ kind: 'added', statement: 'He now answers to [[The Ashen Ledger]].' }],
			model: routed(model)
		});

		expect(result.patch).toEqual({
			summary: 'Notes that the Ledger now employs Aldric.',
			before: currentBody,
			after: proposedBody
		});
		expect(result.provider).toBe('test-provider');
		expect(result.modelId).toBe('test-premium');
		expect(result.credits).toBeGreaterThan(0);

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, 'propagate.diff'));
		const matching = calls.filter((c) => c.userId === owner.id);
		expect(matching).toHaveLength(1);
		expect(matching[0]?.agent).toBe('propagate');
		expect(matching[0]?.inputTokens).toBe(200);
		expect(matching[0]?.outputTokens).toBe(150);
		// Real per-token euro cost, independent of the flat operation_price credit charge -
		// this is the margin question SPEC.md §15 answers from these two columns.
		expect(matching[0]?.costEur).toBeGreaterThan(0);
	});
});
