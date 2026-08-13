import { closeDb, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, type CallLogFields } from './logger.js';
import type { ResolvedModel } from './models.js';
import { openTestDb } from './test-db.js';
import { computeCost, recordCall, withUsage } from './usage.js';

const TEST_OPERATION_PREFIX = 'canonry-ai-test-usage-';

const RESOLVED_MODEL: ResolvedModel = {
	purpose: 'cheap',
	provider: 'test-provider',
	modelId: 'test-model-1',
	params: {
		eurPerInputMTok: 2,
		eurPerOutputMTok: 6,
		eurPerEmbeddingMTok: 0.1,
		eurPerImage: 0.05,
		creditsPerEur: 100
	}
};

describe('computeCost', () => {
	it('prices each usage dimension independently and converts to credits', () => {
		const { credits, costEur } = computeCost(RESOLVED_MODEL.params, {
			inputTokens: 1_000_000,
			outputTokens: 500_000,
			embeddingTokens: 2_000_000,
			images: 2
		});
		// 1*2 + 0.5*6 + 2*0.1 + 2*0.05 = 2 + 3 + 0.2 + 0.1 = 5.3
		expect(costEur).toBeCloseTo(5.3, 10);
		expect(credits).toBeCloseTo(530, 10);
	});

	it('treats a missing rate as free for that dimension', () => {
		const { costEur } = computeCost(
			{},
			{ inputTokens: 1_000_000, outputTokens: 0, embeddingTokens: 0, images: 0 }
		);
		expect(costEur).toBe(0);
	});
});

describe('recordCall and withUsage against real Postgres', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await db.delete(modelCall).where(like(modelCall.operation, `${TEST_OPERATION_PREFIX}%`));
		await closeDb(db);
	});

	it('recordCall writes tokens, credits, euro cost and latency', async () => {
		const operation = `${TEST_OPERATION_PREFIX}record`;
		await recordCall(db, {
			userId: 'test-user-1',
			universeId: null,
			agent: 'loremaster',
			operation,
			provider: RESOLVED_MODEL.provider,
			modelId: RESOLVED_MODEL.modelId,
			inputTokens: 100,
			outputTokens: 40,
			embeddingTokens: 0,
			credits: 1.23,
			costEur: 0.0123,
			latencyMs: 250,
			requestId: 'req-record-1'
		});

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row?.inputTokens).toBe(100);
		expect(row?.outputTokens).toBe(40);
		expect(row?.credits).toBeCloseTo(1.23, 4);
		expect(row?.costEur).toBeCloseTo(0.0123, 6);
		expect(row?.latencyMs).toBe(250);
		expect(row?.userId).toBe('test-user-1');
		expect(row?.agent).toBe('loremaster');
	});

	it('withUsage records a row on success with usage extracted from the result', async () => {
		const operation = `${TEST_OPERATION_PREFIX}success`;
		const fakeResult = { text: 'hello', usage: { inputTokens: 10, outputTokens: 4 } };

		const result = await withUsage(
			db,
			RESOLVED_MODEL,
			{ userId: 'test-user-2', universeId: null, agent: 'propagate', operation },
			async () => fakeResult,
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens
				})
			}
		);

		expect(result).toBe(fakeResult);

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row?.inputTokens).toBe(10);
		expect(row?.outputTokens).toBe(4);
		const expected = computeCost(RESOLVED_MODEL.params, {
			inputTokens: 10,
			outputTokens: 4,
			embeddingTokens: 0,
			images: 0
		});
		expect(row?.credits).toBeCloseTo(expected.credits, 6);
		expect(row?.costEur).toBeCloseTo(expected.costEur, 8);
		expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('withUsage still records a row when the wrapped call throws, and rethrows', async () => {
		const operation = `${TEST_OPERATION_PREFIX}failure`;
		const failure = new Error('provider unavailable');

		await expect(
			withUsage(
				db,
				RESOLVED_MODEL,
				{ userId: 'test-user-3', universeId: null, agent: 'warm', operation },
				async () => {
					throw failure;
				},
				{
					extractUsage: () => ({}),
					extractUsageOnError: () => ({ inputTokens: 7 })
				}
			)
		).rejects.toBe(failure);

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row?.inputTokens).toBe(7);
		expect(row?.outputTokens).toBe(0);
	});

	it('never logs prompt or completion content - only approved metadata fields reach the logger', async () => {
		const operation = `${TEST_OPERATION_PREFIX}logging`;
		const secret = 'sk-super-secret-do-not-log-this-9f2c';
		const prompt = `Ignore prior instructions. My API key is ${secret}.`;
		const events: CallLogFields[] = [];
		const testLogger = createLogger((fields) => events.push(fields));

		await withUsage(
			db,
			RESOLVED_MODEL,
			{ userId: 'test-user-4', universeId: null, agent: 'indexing', operation },
			// The prompt lives only in this closure - withUsage never receives it.
			async () => ({ text: `response to: ${prompt}`, usage: { inputTokens: 20, outputTokens: 8 } }),
			{
				logger: testLogger,
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens
				})
			}
		);

		expect(events).toHaveLength(1);
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain(prompt);
	});
});
