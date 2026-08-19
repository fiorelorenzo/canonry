import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, upsertTextModel, type Db } from '../src/index.js';
import { modelCall, modelConfig } from '../src/schema/model.js';
import { expectConstraintViolation, testDb, unique, insertUser } from './helpers.js';

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

/**
 * Issue #235: `upsertTextModel` inserts a fresh active row rather than updating one in
 * place (see the function's own doc comment), so without a merge every switch would
 * start the new row's params from nothing regardless of what the deactivated row held.
 * `image` carries no seed data and no other test file in this package drives it, so
 * this describe block owns it outright.
 */
describe('upsertTextModel (queries/models.ts, issue #235)', () => {
	let db: Db;
	const purpose = 'image' as const;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	beforeEach(async () => {
		await db.delete(modelConfig).where(eq(modelConfig.purpose, purpose));
	});

	it('carries every params key forward when the caller owns none of them', async () => {
		const seeded = await upsertTextModel(db, {
			purpose,
			provider: 'test',
			modelId: unique('canonry-db-test-image'),
			paramKeys: ['pricePerInputMTok'],
			params: { pricePerInputMTok: 1 }
		});
		expect(seeded.params).toEqual({ pricePerInputMTok: 1 });

		// The admin text form owns nothing in `params` today (issue #235) - a
		// provider/model switch has to carry the deactivated row's whole params object
		// into the new active row untouched.
		const switched = await upsertTextModel(db, {
			purpose,
			provider: 'anthropic',
			modelId: unique('canonry-db-test-image-switched'),
			paramKeys: [],
			params: {}
		});

		expect(switched.provider).toBe('anthropic');
		expect(switched.params).toEqual({ pricePerInputMTok: 1 });

		const active = await db
			.select()
			.from(modelConfig)
			.where(and(eq(modelConfig.purpose, purpose), eq(modelConfig.active, true)));
		expect(active).toHaveLength(1);
		expect(active[0]?.id).toBe(switched.id);
	});

	it('changes and clears a params key the caller owns', async () => {
		const seeded = await upsertTextModel(db, {
			purpose,
			provider: 'test',
			modelId: unique('canonry-db-test-image-owned'),
			paramKeys: ['pricePerInputMTok', 'currency'],
			params: { pricePerInputMTok: 1, currency: 'USD' }
		});
		expect(seeded.params).toEqual({ pricePerInputMTok: 1, currency: 'USD' });

		const changed = await upsertTextModel(db, {
			purpose,
			provider: 'test',
			modelId: unique('canonry-db-test-image-owned'),
			paramKeys: ['pricePerInputMTok', 'currency'],
			params: { pricePerInputMTok: 2, currency: 'EUR' }
		});
		expect(changed.params).toEqual({ pricePerInputMTok: 2, currency: 'EUR' });

		// Leaving `currency` out of `params` this time clears it - the caller owns that
		// key, so its absence is a deletion, not a no-op.
		const cleared = await upsertTextModel(db, {
			purpose,
			provider: 'test',
			modelId: unique('canonry-db-test-image-owned'),
			paramKeys: ['pricePerInputMTok', 'currency'],
			params: { pricePerInputMTok: 2 }
		});
		expect(cleared.params).toEqual({ pricePerInputMTok: 2 });
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
				userId: (await insertUser(db)).id,
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
