import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from '../src/index.js';
import { modelCall, modelConfig } from '../src/schema/model.js';
import { expectConstraintViolation, testDb, unique } from './helpers.js';

describe('model_config', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('allows only one active row per purpose', async () => {
		const purpose = 'cheap' as const;
		// Clear any active row from a previous run before asserting exclusivity here.
		await db.update(modelConfig).set({ active: false }).where(eq(modelConfig.purpose, purpose));

		await db.insert(modelConfig).values({
			purpose,
			provider: 'openai',
			modelId: unique('gpt'),
			active: true
		});

		await expectConstraintViolation(
			db.insert(modelConfig).values({
				purpose,
				provider: 'anthropic',
				modelId: unique('claude'),
				active: true
			}),
			'model_config_active_purpose_key'
		);

		// A second inactive row for the same purpose is fine - only "active" is constrained.
		await expect(
			db.insert(modelConfig).values({
				purpose,
				provider: 'anthropic',
				modelId: unique('claude'),
				active: false
			})
		).resolves.not.toThrow();

		const active = await db
			.select()
			.from(modelConfig)
			.where(and(eq(modelConfig.purpose, purpose), eq(modelConfig.active, true)));
		expect(active).toHaveLength(1);
	});
});

describe('model_call', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('records tokens and cost for a call', async () => {
		const [row] = await db
			.insert(modelCall)
			.values({
				userId: unique('user'),
				agent: 'loremaster',
				operation: 'query_lore',
				provider: 'openai',
				modelId: 'gpt-5-mini',
				inputTokens: 1200,
				outputTokens: 340,
				embeddingTokens: 0,
				credits: 0.42,
				costEur: 0.001834,
				latencyMs: 812
			})
			.returning();

		expect(row).toBeDefined();
		expect(row?.inputTokens).toBe(1200);
		expect(row?.outputTokens).toBe(340);
		expect(row?.credits).toBeCloseTo(0.42);
		expect(row?.costEur).toBeCloseTo(0.001834);
	});
});
