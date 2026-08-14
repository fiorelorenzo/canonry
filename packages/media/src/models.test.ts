import { closeDb, eq, and, type Db } from '@canonry/db';
import { imageModelConfig } from '@canonry/db/schema';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ImageModelNotConfiguredError,
	clearImageModelCache,
	resolveImageModel,
	resolveImageModelRow
} from './models.js';
import { openTestDb } from './test-db.js';

const TEST_MODEL_ID_PREFIX = 'canonry-media-test-';

// This package's tests run against their own isolated database (test-global-setup.ts),
// migrated fresh for every run - including the seed migration's real portrait/variants
// rows (SPEC.md §9). Deleting everything rather than a prefix match keeps every test
// starting from a clean slate without fighting the active-per-feature unique index.
async function deleteAllRows(db: Db): Promise<void> {
	await db.delete(imageModelConfig);
}

describe('resolveImageModel / resolveImageModelRow (#64)', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await deleteAllRows(db);
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
				params: { eurPerImage: 0.02 }
			},
			{
				feature: 'variants',
				provider: 'replicate',
				modelId: `${TEST_MODEL_ID_PREFIX}flux-schnell`,
				active: true,
				params: { eurPerImage: 0.01 }
			}
		]);

		const portrait = await resolveImageModel(db, 'portrait');
		expect(portrait).toEqual({
			purpose: 'image',
			provider: 'replicate',
			modelId: `${TEST_MODEL_ID_PREFIX}p-image`,
			params: { eurPerImage: 0.02 }
		});

		const variants = await resolveImageModel(db, 'variants');
		expect(variants.modelId).toBe(`${TEST_MODEL_ID_PREFIX}flux-schnell`);
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
