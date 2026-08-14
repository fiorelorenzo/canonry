import { closeDb, type Db } from '@canonry/db';
import { modelCall, operationPrice, operationPriceChange, user } from '@canonry/db/schema';
import { inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, type CallLogFields } from './logger.js';
import type { ResolvedModel } from './models.js';
import { clearPriceCache } from './prices.js';
import { openTestDb } from './test-db.js';
import { computeCost, recordCall, withUsage } from './usage.js';

const TEST_OPERATION_PREFIX = 'canonry-ai-test-usage-';
// Price fixtures for the withUsage tests below, seeded once in beforeAll so chargeFor has
// a row to resolve for each test operation. SUCCESS_OPERATION and LOGGING_OPERATION are
// priced like a real generation call; FREE_OPERATION is priced at zero, the same as any
// reading operation, to prove withUsage still records tokens on a zero-credit call.
const SUCCESS_OPERATION = `${TEST_OPERATION_PREFIX}success`;
const FAILURE_OPERATION = `${TEST_OPERATION_PREFIX}failure`;
const LOGGING_OPERATION = `${TEST_OPERATION_PREFIX}logging`;
const FREE_OPERATION = `${TEST_OPERATION_PREFIX}free`;
const SUCCESS_PRICE_CREDITS = 3.5;
const FAILURE_PRICE_CREDITS = 1.25;
const LOGGING_PRICE_CREDITS = 2;
// model_call.user_id gained a real FK to user.id in migration 0014, so every userId
// this file uses needs a real row behind it.
const TEST_USER_IDS = [
	'test-user-usage-1',
	'test-user-usage-2',
	'test-user-usage-3',
	'test-user-usage-4',
	'test-user-usage-free'
];

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

	beforeAll(async () => {
		db = openTestDb();
		clearPriceCache();
		await db
			.insert(user)
			.values(
				TEST_USER_IDS.map((id) => ({
					id,
					name: 'Test User',
					email: `${id}@canonry.invalid`,
					emailVerified: true
				}))
			)
			.onConflictDoNothing();
		await db.insert(operationPrice).values([
			{
				operation: SUCCESS_OPERATION,
				label: 'Test success operation',
				credits: SUCCESS_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: FAILURE_OPERATION,
				label: 'Test failure operation',
				credits: FAILURE_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: LOGGING_OPERATION,
				label: 'Test logging operation',
				credits: LOGGING_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: FREE_OPERATION,
				label: 'Test free operation',
				credits: 0,
				kind: 'reading'
			}
		]);
	});

	afterAll(async () => {
		await db.delete(modelCall).where(like(modelCall.operation, `${TEST_OPERATION_PREFIX}%`));
		await db
			.delete(operationPriceChange)
			.where(like(operationPriceChange.operation, `${TEST_OPERATION_PREFIX}%`));
		await db
			.delete(operationPrice)
			.where(like(operationPrice.operation, `${TEST_OPERATION_PREFIX}%`));
		await db.delete(user).where(inArray(user.id, TEST_USER_IDS));
		await closeDb(db);
	});

	it('recordCall writes tokens, credits, euro cost and latency', async () => {
		const operation = `${TEST_OPERATION_PREFIX}record`;
		await recordCall(db, {
			userId: 'test-user-usage-1',
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
		expect(row?.userId).toBe('test-user-usage-1');
		expect(row?.agent).toBe('loremaster');
	});

	it('withUsage records credits from the operation_price table, not from token arithmetic', async () => {
		const operation = SUCCESS_OPERATION;
		const fakeResult = { text: 'hello', usage: { inputTokens: 10, outputTokens: 4 } };

		const result = await withUsage(
			db,
			RESOLVED_MODEL,
			{ userId: 'test-user-usage-2', universeId: null, agent: 'propagate', operation },
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
		// credits comes from the operation_price row, not the token-based computeCost figure
		// that priced it before this issue - the two would disagree here on purpose.
		expect(row?.credits).toBeCloseTo(SUCCESS_PRICE_CREDITS, 6);
		const expectedCostEur = computeCost(RESOLVED_MODEL.params, {
			inputTokens: 10,
			outputTokens: 4,
			embeddingTokens: 0,
			images: 0
		}).costEur;
		expect(row?.costEur).toBeCloseTo(expectedCostEur, 8);
		expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('withUsage records a zero-credit row for a free operation, tokens intact', async () => {
		const operation = FREE_OPERATION;
		const fakeResult = { text: 'hits', usage: { inputTokens: 30, outputTokens: 0 } };

		await withUsage(
			db,
			RESOLVED_MODEL,
			{ userId: 'test-user-usage-free', universeId: null, agent: 'indexing', operation },
			async () => fakeResult,
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens
				})
			}
		);

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row?.credits).toBe(0);
		// Free to the user is not free to us (SPEC.md §15): the real tokens and euro cost
		// still land on the row even though credits is zero.
		expect(row?.inputTokens).toBe(30);
		expect(row?.costEur).toBeGreaterThan(0);
	});

	it('withUsage still records a row, priced from the table, when the wrapped call throws, and rethrows', async () => {
		const operation = FAILURE_OPERATION;
		const failure = new Error('provider unavailable');

		await expect(
			withUsage(
				db,
				RESOLVED_MODEL,
				{ userId: 'test-user-usage-3', universeId: null, agent: 'warm', operation },
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
		expect(row?.credits).toBeCloseTo(FAILURE_PRICE_CREDITS, 6);
	});

	it('never logs prompt or completion content - only approved metadata fields reach the logger', async () => {
		const operation = LOGGING_OPERATION;
		const secret = 'sk-super-secret-do-not-log-this-9f2c';
		const prompt = `Ignore prior instructions. My API key is ${secret}.`;
		const events: CallLogFields[] = [];
		const testLogger = createLogger((fields) => events.push(fields));

		await withUsage(
			db,
			RESOLVED_MODEL,
			{ userId: 'test-user-usage-4', universeId: null, agent: 'indexing', operation },
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
		expect(events[0]?.credits).toBeCloseTo(LOGGING_PRICE_CREDITS, 6);
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain(prompt);
	});
});
