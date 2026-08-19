/**
 * Issue #235: a save through `upsertImageModel` must merge into the row's existing
 * `params` rather than replace it wholesale - a key the caller's form does not render
 * (`imagesPerRequest`, migration 0011) has to survive an unrelated save, and a key the
 * caller does own has to be changeable *and* removable, since "merge" cannot mean
 * "never delete anything".
 *
 * `scene` carries no seed data (migration 0011 only seeds `portrait`/`variants`) and no
 * other test file in this package drives it, so this file owns it outright with no
 * cross-file locking needed - unlike packages/media's own image_model_config tests,
 * which share `portrait`/`variants` across two files and take an advisory lock for it.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	closeDb,
	createMediaAsset,
	setMediaAssetPublished,
	upsertImageModel,
	type Db
} from '../src/index.js';
import { imageModelConfig } from '../src/schema/media.js';
import { insertHomebrewUniverse, testDb } from './helpers.js';

const FEATURE = 'scene' as const;
const IMAGE_PRICE_PARAM_KEYS = ['pricePerImage', 'currency'] as const;

describe('upsertImageModel (queries/media.ts, issue #235)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	beforeEach(async () => {
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, FEATURE));
	});

	it('preserves a params key the caller does not own across an unrelated save', async () => {
		await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-v1',
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});

		// Seed a key the price form never renders, the way migration 0011 seeded
		// imagesPerRequest - directly on the row, since no caller owns it.
		await db
			.update(imageModelConfig)
			.set({ params: { pricePerImage: 0.02, currency: 'USD', imagesPerRequest: 4 } })
			.where(eq(imageModelConfig.feature, FEATURE));

		// An unrelated save: only the model id changes, the two owned keys go back in
		// unchanged, exactly like a real submission of the (already-filled) form.
		const updated = await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-v2',
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});

		expect(updated.modelId).toBe('canonry-db-test-scene-v2');
		expect(updated.params).toEqual({
			pricePerImage: 0.02,
			currency: 'USD',
			imagesPerRequest: 4
		});
	});

	it('changes and clears a params key the caller owns', async () => {
		await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-owned',
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});

		const changed = await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-owned',
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage: 0.05, currency: 'EUR' }
		});
		expect(changed.params).toEqual({ pricePerImage: 0.05, currency: 'EUR' });

		// A caller that owns `currency` but leaves it out of this call's `params` clears
		// it - "merge" still has to be able to delete a key the caller owns, not just
		// overwrite it with something new.
		const cleared = await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-owned',
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage: 0.05 }
		});
		expect(cleared.params).toEqual({ pricePerImage: 0.05 });
	});

	it('never mixes an owned key into an unowned key nobody asked to touch', async () => {
		await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-mixed',
			paramKeys: IMAGE_PRICE_PARAM_KEYS,
			params: { pricePerImage: 0.02, currency: 'USD' }
		});
		await db
			.update(imageModelConfig)
			.set({ params: { pricePerImage: 0.02, currency: 'USD', imagesPerRequest: 1 } })
			.where(and(eq(imageModelConfig.feature, FEATURE), eq(imageModelConfig.active, true)));

		// Only `pricePerImage` is owned this time - `currency` behaves like any other
		// unowned key and is left exactly as it was, `imagesPerRequest` too.
		const updated = await upsertImageModel(db, {
			feature: FEATURE,
			provider: 'replicate',
			modelId: 'canonry-db-test-scene-mixed',
			paramKeys: ['pricePerImage'],
			params: { pricePerImage: 0.09 }
		});

		expect(updated.params).toEqual({ pricePerImage: 0.09, currency: 'USD', imagesPerRequest: 1 });
	});
});

describe('setMediaAssetPublished (queries/media.ts, issue #254)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('flips published_to_players in both directions and touches nothing else on the row', async () => {
		const u = await insertHomebrewUniverse(db);
		const created = await createMediaAsset(db, {
			universeId: u.id,
			kind: 'image',
			path: '/media/publish-query-test.png',
			mimeType: 'image/png',
			bytes: 128
		});
		expect(created.publishedToPlayers).toBe(false);

		const published = await setMediaAssetPublished(db, created.id, true);
		expect(published.publishedToPlayers).toBe(true);
		expect(published.path).toBe(created.path);
		expect(published.mimeType).toBe(created.mimeType);
		expect(published.entityId).toBe(created.entityId);
		expect(published.bytes).toBe(created.bytes);

		const unpublished = await setMediaAssetPublished(db, created.id, false);
		expect(unpublished.publishedToPlayers).toBe(false);
	});

	it('throws for an id that does not exist, rather than silently doing nothing', async () => {
		await expect(setMediaAssetPublished(db, randomUUID(), true)).rejects.toThrow();
	});
});
