import { closeDb, type Db } from '@canonry/db';
import { modelConfig } from '@canonry/db/schema';
import { and, eq, like, notLike } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearModelCache, ModelNotConfiguredError, resolveModel } from './models.js';
import { openTestDb } from './test-db.js';

// Namespaced so cleanup here never touches fixtures another task's tests left behind.
const TEST_MODEL_ID_PREFIX = 'canonry-ai-test-';

/** The purpose these tests own. Every one of them writes an active row for it, and
 * `model_config_active_purpose_key` allows exactly one, so a seeded row for the same purpose
 * makes every insert fail with a unique violation. `multimodal` used to be safe because
 * nothing seeded it; migration 0027 seeds all three text purposes, so the tests park their
 * own row out of the way instead of relying on a purpose nobody has claimed yet. */
const TEST_PURPOSE = 'multimodal';

async function deleteTestRows(db: Db): Promise<void> {
	await db.delete(modelConfig).where(like(modelConfig.modelId, `${TEST_MODEL_ID_PREFIX}%`));
}

/** Deactivates whatever the migrations seeded for the purpose under test, and puts it back
 * afterwards, so these tests neither depend on the seed nor leave the database without one. */
async function setSeededRowActive(db: Db, active: boolean): Promise<void> {
	await db
		.update(modelConfig)
		.set({ active })
		.where(
			and(
				eq(modelConfig.purpose, TEST_PURPOSE),
				notLike(modelConfig.modelId, `${TEST_MODEL_ID_PREFIX}%`)
			)
		);
}

describe('resolveModel', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await deleteTestRows(db);
		await setSeededRowActive(db, true);
		await closeDb(db);
	});

	beforeEach(async () => {
		clearModelCache();
		await deleteTestRows(db);
		await setSeededRowActive(db, false);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await deleteTestRows(db);
	});

	it('resolves the active row for a purpose', async () => {
		await db.insert(modelConfig).values({
			purpose: 'multimodal',
			provider: 'openai',
			modelId: `${TEST_MODEL_ID_PREFIX}multimodal-v1`,
			active: true,
			params: { eurPerInputMTok: 1.5 }
		});

		const resolved = await resolveModel(db, 'multimodal');
		expect(resolved).toEqual({
			purpose: 'multimodal',
			provider: 'openai',
			modelId: `${TEST_MODEL_ID_PREFIX}multimodal-v1`,
			params: { eurPerInputMTok: 1.5 }
		});
	});

	it('an inactive row does not win over no active row - resolveModel still errors', async () => {
		await db.insert(modelConfig).values({
			purpose: 'multimodal',
			provider: 'openai',
			modelId: `${TEST_MODEL_ID_PREFIX}multimodal-inactive`,
			active: false,
			params: {}
		});

		await expect(resolveModel(db, 'multimodal')).rejects.toThrow(ModelNotConfiguredError);
	});

	it('caches the resolved row for the TTL, then refetches after it expires', async () => {
		const nowSpy = vi.spyOn(Date, 'now');
		const baseTime = 1_700_000_000_000;
		nowSpy.mockReturnValue(baseTime);

		await db.insert(modelConfig).values({
			purpose: 'multimodal',
			provider: 'openai',
			modelId: `${TEST_MODEL_ID_PREFIX}multimodal-original`,
			active: true,
			params: {}
		});

		const first = await resolveModel(db, 'multimodal');
		expect(first.modelId).toBe(`${TEST_MODEL_ID_PREFIX}multimodal-original`);

		// Admin switches the active model in place (same row, unique index untouched).
		await db
			.update(modelConfig)
			.set({ modelId: `${TEST_MODEL_ID_PREFIX}multimodal-switched` })
			.where(and(eq(modelConfig.purpose, 'multimodal'), eq(modelConfig.active, true)));

		// Still within the 30s TTL: cache holds, stale value returned.
		nowSpy.mockReturnValue(baseTime + 29_000);
		const stillCached = await resolveModel(db, 'multimodal');
		expect(stillCached.modelId).toBe(`${TEST_MODEL_ID_PREFIX}multimodal-original`);

		// Past the TTL: cache expired, the switch is now visible.
		nowSpy.mockReturnValue(baseTime + 30_001);
		const refreshed = await resolveModel(db, 'multimodal');
		expect(refreshed.modelId).toBe(`${TEST_MODEL_ID_PREFIX}multimodal-switched`);
	});

	it('clearModelCache empties the cache immediately, without waiting for the TTL', async () => {
		const nowSpy = vi.spyOn(Date, 'now');
		const baseTime = 1_700_000_000_000;
		nowSpy.mockReturnValue(baseTime);

		await db.insert(modelConfig).values({
			purpose: 'multimodal',
			provider: 'openai',
			modelId: `${TEST_MODEL_ID_PREFIX}multimodal-a`,
			active: true,
			params: {}
		});

		const first = await resolveModel(db, 'multimodal');
		expect(first.modelId).toBe(`${TEST_MODEL_ID_PREFIX}multimodal-a`);

		await db
			.update(modelConfig)
			.set({ modelId: `${TEST_MODEL_ID_PREFIX}multimodal-b` })
			.where(and(eq(modelConfig.purpose, 'multimodal'), eq(modelConfig.active, true)));

		// Same instant, well within the TTL - only clearModelCache should make the switch visible.
		clearModelCache();
		const afterClear = await resolveModel(db, 'multimodal');
		expect(afterClear.modelId).toBe(`${TEST_MODEL_ID_PREFIX}multimodal-b`);
	});

	it('raises an error naming the purpose when no active row exists', async () => {
		// 'image' rather than 'embedding': migration 0022 seeds a real embedding row (issue #125),
		// so that purpose is configured now. Image models live in `image_model_config`, keyed by
		// feature, so `model_config`'s 'image' purpose is the one that genuinely has no row.
		await expect(resolveModel(db, 'image')).rejects.toThrow(/image/);
		await expect(resolveModel(db, 'image')).rejects.toBeInstanceOf(ModelNotConfiguredError);
	});
});
