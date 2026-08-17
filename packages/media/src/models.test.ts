import { closeDb, eq, and, type Db } from '@canonry/db';
import { imageModelConfig } from '@canonry/db/schema';
import { computeCost } from '@canonry/ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ImageModelNotConfiguredError,
	clearImageModelCache,
	resolveImageModel,
	resolveImageModelRow
} from './models.js';
import {
	lockImageModelConfigForFile,
	openTestDb,
	unlockImageModelConfigForFile
} from './test-db.js';

const TEST_MODEL_ID_PREFIX = 'canonry-media-test-';

// This package's tests run against their own isolated database (test-global-setup.ts),
// migrated fresh for every run - including the seed migration's real portrait/variants
// rows (SPEC.md §9). Deleting everything rather than a prefix match keeps every test in
// *this* file starting from a clean slate without fighting the active-per-feature unique
// index; the lock this file's beforeAll/afterAll hold on image_model_config (see
// lockImageModelConfigForFile, #193) is what keeps that clean slate from being raced by
// generate.test.ts, which also drives the same feature rows.
async function deleteAllRows(db: Db): Promise<void> {
	await db.delete(imageModelConfig);
}

describe('resolveImageModel / resolveImageModelRow (#64)', () => {
	let db: Db;

	beforeAll(async () => {
		db = openTestDb();
		await lockImageModelConfigForFile(db);
	});

	afterAll(async () => {
		await deleteAllRows(db);
		await unlockImageModelConfigForFile(db);
		await closeDb(db);
	});

	beforeEach(async () => {
		clearImageModelCache();
		await deleteAllRows(db);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await deleteAllRows(db);
	});

	it('resolves the active model per feature - portrait and variants stay independent', async () => {
		await db.insert(imageModelConfig).values([
			{
				feature: 'portrait',
				provider: 'replicate',
				modelId: `${TEST_MODEL_ID_PREFIX}p-image`,
				active: true,
				params: { pricePerImage: 0.02, currency: 'USD' }
			},
			{
				feature: 'variants',
				provider: 'replicate',
				modelId: `${TEST_MODEL_ID_PREFIX}flux-schnell`,
				active: true,
				params: { pricePerImage: 0.01, currency: 'USD' }
			}
		]);

		const portrait = await resolveImageModel(db, 'portrait');
		expect(portrait).toEqual({
			purpose: 'image',
			provider: 'replicate',
			modelId: `${TEST_MODEL_ID_PREFIX}p-image`,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});

		const variants = await resolveImageModel(db, 'variants');
		expect(variants.modelId).toBe(`${TEST_MODEL_ID_PREFIX}flux-schnell`);
	});

	it('round-trips a USD-stored price and a EUR-stored price to the same real euro cost (issue #132)', async () => {
		// prunaai/p-image's real Replicate list price, $0.02 - stored as-is, the way
		// migration 0034 restates it, not pre-converted at seed time.
		await db.insert(imageModelConfig).values({
			feature: 'portrait',
			provider: 'replicate',
			modelId: `${TEST_MODEL_ID_PREFIX}usd-p-image`,
			active: true,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});
		const usdModel = await resolveImageModel(db, 'portrait');
		const usdCost = computeCost(usdModel.params, {
			inputTokens: 0,
			outputTokens: 0,
			embeddingTokens: 0,
			images: 1
		}).costEur;

		clearImageModelCache();
		await db.delete(imageModelConfig);

		// A price already in euros - toEur must leave it exactly alone, not divide it
		// again by the same rate.
		await db.insert(imageModelConfig).values({
			feature: 'portrait',
			provider: 'replicate',
			modelId: `${TEST_MODEL_ID_PREFIX}eur-p-image`,
			active: true,
			params: { pricePerImage: usdCost, currency: 'EUR' }
		});
		const eurModel = await resolveImageModel(db, 'portrait');
		const eurCost = computeCost(eurModel.params, {
			inputTokens: 0,
			outputTokens: 0,
			embeddingTokens: 0,
			images: 1
		}).costEur;

		expect(usdCost).toBeLessThan(0.02);
		expect(usdCost).toBeCloseTo(0.017291, 5);
		expect(eurCost).toBe(usdCost);
	});

	it('an inactive row does not win over no active row', async () => {
		await db.insert(imageModelConfig).values({
			feature: 'portrait',
			provider: 'replicate',
			modelId: `${TEST_MODEL_ID_PREFIX}inactive`,
			active: false,
			params: {}
		});

		await expect(resolveImageModelRow(db, 'portrait')).rejects.toThrow(
			ImageModelNotConfiguredError
		);
	});

	it('raises an error naming the feature when no active row exists', async () => {
		await expect(resolveImageModelRow(db, 'scene')).rejects.toThrow(/scene/);
		await expect(resolveImageModelRow(db, 'scene')).rejects.toBeInstanceOf(
			ImageModelNotConfiguredError
		);
	});

	it('an admin switch takes effect without a restart, once the cache is cleared (#64 acceptance)', async () => {
		const nowSpy = vi.spyOn(Date, 'now');
		const baseTime = 1_700_000_000_000;
		nowSpy.mockReturnValue(baseTime);

		await db.insert(imageModelConfig).values({
			feature: 'portrait',
			provider: 'replicate',
			modelId: `${TEST_MODEL_ID_PREFIX}original`,
			active: true,
			params: {}
		});

		const first = await resolveImageModelRow(db, 'portrait');
		expect(first.modelId).toBe(`${TEST_MODEL_ID_PREFIX}original`);

		// The admin panel updates the same active row in place (upsertImageModel), exactly
		// what /admin/models's save action does.
		await db
			.update(imageModelConfig)
			.set({ modelId: `${TEST_MODEL_ID_PREFIX}switched` })
			.where(and(eq(imageModelConfig.feature, 'portrait'), eq(imageModelConfig.active, true)));

		// Still inside the 30s TTL: cache holds the stale value...
		nowSpy.mockReturnValue(baseTime + 10_000);
		const stillCached = await resolveImageModelRow(db, 'portrait');
		expect(stillCached.modelId).toBe(`${TEST_MODEL_ID_PREFIX}original`);

		// ...until the admin save clears the cache, exactly like clearPriceCache does for
		// /admin/pricing - the switch is then visible on the very next request, no restart.
		clearImageModelCache();
		const afterClear = await resolveImageModelRow(db, 'portrait');
		expect(afterClear.modelId).toBe(`${TEST_MODEL_ID_PREFIX}switched`);
	});
});
