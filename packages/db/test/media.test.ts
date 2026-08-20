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
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	closeDb,
	createMediaAsset,
	deleteMediaAsset,
	entryStyleContext,
	ImageStylePresetNotFoundError,
	listImageStylePresets,
	mediaAssetById,
	selectUniverseImageStylePreset,
	setMediaAssetGmOnly,
	upsertImageModel,
	upsertUniverseImageStyle,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { imageModelConfig, imageStyle } from '../src/schema/media.js';
import { universe } from '../src/schema/universe.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

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

describe('setMediaAssetGmOnly (queries/media.ts, issue #382)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('flips gm_only in both directions and touches nothing else on the row', async () => {
		const u = await insertHomebrewUniverse(db);
		const created = await createMediaAsset(db, {
			universeId: u.id,
			kind: 'image',
			path: '/media/publish-query-test.png',
			mimeType: 'image/png',
			bytes: 128
		});
		expect(created.gmOnly).toBe(false);

		const held = await setMediaAssetGmOnly(db, created.id, true);
		expect(held.gmOnly).toBe(true);
		expect(held.path).toBe(created.path);
		expect(held.mimeType).toBe(created.mimeType);
		expect(held.entityId).toBe(created.entityId);
		expect(held.bytes).toBe(created.bytes);

		const released = await setMediaAssetGmOnly(db, created.id, false);
		expect(released.gmOnly).toBe(false);
	});

	it('throws for an id that does not exist, rather than silently doing nothing', async () => {
		await expect(setMediaAssetGmOnly(db, randomUUID(), true)).rejects.toThrow();
	});
});

describe('upsertUniverseImageStyle (queries/media.ts, issue #378, decision R3)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('inserts a row for the first save and points universe.image_style_id at it', async () => {
		const u = await insertHomebrewUniverse(db);
		expect(u.imageStyleId).toBeNull();

		const style = await upsertUniverseImageStyle(db, {
			universeId: u.id,
			name: 'Woodcut',
			promptModifier: 'monochrome woodcut, heavy crosshatching'
		});
		expect(style.name).toBe('Woodcut');
		expect(style.universeId).toBe(u.id);

		const [row] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(row?.imageStyleId).toBe(style.id);
	});

	it('a second save updates the same row in place rather than accumulating a second one', async () => {
		const u = await insertHomebrewUniverse(db);
		const first = await upsertUniverseImageStyle(db, {
			universeId: u.id,
			name: 'Woodcut',
			promptModifier: 'monochrome woodcut'
		});

		const second = await upsertUniverseImageStyle(db, {
			universeId: u.id,
			name: 'Ink wash',
			promptModifier: 'loose ink wash, visible brush strokes'
		});
		expect(second.id).toBe(first.id);

		const rows = await db.select().from(imageStyle).where(eq(imageStyle.universeId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name: 'Ink wash',
			promptModifier: 'loose ink wash, visible brush strokes'
		});

		const [row] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(row?.imageStyleId).toBe(first.id);
	});

	it('two different universes never share a row, even with the same name', async () => {
		const a = await insertHomebrewUniverse(db);
		const b = await insertHomebrewUniverse(db);

		const styleA = await upsertUniverseImageStyle(db, {
			universeId: a.id,
			name: 'Woodcut',
			promptModifier: 'monochrome woodcut'
		});
		const styleB = await upsertUniverseImageStyle(db, {
			universeId: b.id,
			name: 'Woodcut',
			promptModifier: 'different modifier entirely'
		});

		expect(styleA.id).not.toBe(styleB.id);
		const [rowA] = await db.select().from(universe).where(eq(universe.id, a.id));
		const [rowB] = await db.select().from(universe).where(eq(universe.id, b.id));
		expect(rowA?.imageStyleId).toBe(styleA.id);
		expect(rowB?.imageStyleId).toBe(styleB.id);
	});

	it('throws for a universe id that does not exist', async () => {
		await expect(
			upsertUniverseImageStyle(db, {
				universeId: randomUUID(),
				name: 'Woodcut',
				promptModifier: 'monochrome woodcut'
			})
		).rejects.toThrow();
	});

	it('issue #407: never edits a preset a universe currently points at - saving a custom style creates the universe its own row instead', async () => {
		const u = await insertHomebrewUniverse(db);
		const [preset] = await db
			.select({
				id: imageStyle.id,
				name: imageStyle.name,
				promptModifier: imageStyle.promptModifier
			})
			.from(imageStyle)
			.where(isNull(imageStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded preset to test against');

		await selectUniverseImageStylePreset(db, u.id, preset.id);
		const [pointed] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(pointed?.imageStyleId).toBe(preset.id);

		const custom = await upsertUniverseImageStyle(db, {
			universeId: u.id,
			name: 'My Own Style',
			promptModifier: 'a look nobody else gets'
		});

		// The preset itself never changed.
		const [presetAfter] = await db.select().from(imageStyle).where(eq(imageStyle.id, preset.id));
		expect(presetAfter).toMatchObject({ name: preset.name, promptModifier: preset.promptModifier });

		// A new, separate row belongs to this universe, and the universe now points at it.
		expect(custom.id).not.toBe(preset.id);
		expect(custom.universeId).toBe(u.id);
		const [row] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(row?.imageStyleId).toBe(custom.id);
	});
});

describe('listImageStylePresets (queries/media.ts, issue #407, decision S2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('returns the shipped catalogue in English by default, ordered by sort_order', async () => {
		const presets = await listImageStylePresets(db, 'en');
		const inkWash = presets.find((p) => p.slug === 'ink-wash');
		const woodcut = presets.find((p) => p.slug === 'woodcut');
		expect(inkWash).toMatchObject({ name: 'Ink Wash' });
		expect(woodcut).toMatchObject({ name: 'Woodcut' });
		expect(inkWash?.description.length).toBeGreaterThan(0);
		expect(inkWash?.examplePath).toBe('/style-examples/ink-wash.webp');
		expect(inkWash?.promptModifier.length).toBeGreaterThan(0);

		const sortOrders = presets.map((p) => p.sortOrder);
		expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
	});

	it('returns the Italian translation when asked for it', async () => {
		const presets = await listImageStylePresets(db, 'it');
		const inkWash = presets.find((p) => p.slug === 'ink-wash');
		expect(inkWash?.name).toBe('Inchiostro e Acquerello');
		expect(inkWash?.name).not.toBe('Ink Wash');
	});

	it('falls back to the English row for a locale with no translation', async () => {
		const presets = await listImageStylePresets(db, 'fr');
		const inkWash = presets.find((p) => p.slug === 'ink-wash');
		expect(inkWash?.name).toBe('Ink Wash');
	});

	it('never includes a universe-owned custom row', async () => {
		const u = await insertHomebrewUniverse(db);
		await upsertUniverseImageStyle(db, {
			universeId: u.id,
			name: 'Should Never Appear In The Catalogue',
			promptModifier: 'x'
		});
		const presets = await listImageStylePresets(db, 'en');
		expect(presets.some((p) => p.name === 'Should Never Appear In The Catalogue')).toBe(false);
	});
});

describe('selectUniverseImageStylePreset (queries/media.ts, issue #407, decision S2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('points the universe at a real preset', async () => {
		const u = await insertHomebrewUniverse(db);
		const [preset] = await db
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(isNull(imageStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded preset to test against');

		await selectUniverseImageStylePreset(db, u.id, preset.id);
		const [row] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(row?.imageStyleId).toBe(preset.id);
	});

	it('refuses a target id that does not exist', async () => {
		const u = await insertHomebrewUniverse(db);
		await expect(selectUniverseImageStylePreset(db, u.id, randomUUID())).rejects.toThrow(
			ImageStylePresetNotFoundError
		);
	});

	it('refuses a target that is another universe custom row, so a GM cannot point at private content by guessing its id', async () => {
		const owner = await insertHomebrewUniverse(db);
		const attacker = await insertHomebrewUniverse(db);
		const ownersCustomStyle = await upsertUniverseImageStyle(db, {
			universeId: owner.id,
			name: 'Owners Private Style',
			promptModifier: 'secret sauce'
		});

		await expect(
			selectUniverseImageStylePreset(db, attacker.id, ownersCustomStyle.id)
		).rejects.toThrow(ImageStylePresetNotFoundError);

		const [attackerRow] = await db.select().from(universe).where(eq(universe.id, attacker.id));
		expect(attackerRow?.imageStyleId).toBeNull();
	});

	it('throws for a universe id that does not exist', async () => {
		const [preset] = await db
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(isNull(imageStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded preset to test against');
		await expect(selectUniverseImageStylePreset(db, randomUUID(), preset.id)).rejects.toThrow();
	});
});

describe('image_style presets: re-seed in place (migration 0048, issue #407, decision S2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	// Exercises the exact mechanism migration 0048's `ON CONFLICT ("slug") DO UPDATE`
	// depends on - the `slug` unique constraint schema/media.ts declares - against a
	// throwaway slug rather than one of the six shipped presets, so this never risks
	// leaving the real catalogue (and the screenshots taken against it) in a mutated
	// state for another test or a later run in the same suite to trip over.
	it('a second insert with the same slug updates the row in place and never duplicates it', async () => {
		const slug = unique('reseed-preset');

		const [first] = await db
			.insert(imageStyle)
			.values({
				slug,
				name: 'Draft Name',
				description: 'Draft description.',
				promptModifier: 'draft modifier',
				examplePath: '/style-examples/draft.webp',
				sortOrder: 99
			})
			.onConflictDoUpdate({
				target: imageStyle.slug,
				set: {
					name: 'Draft Name',
					description: 'Draft description.',
					promptModifier: 'draft modifier',
					examplePath: '/style-examples/draft.webp',
					sortOrder: 99
				}
			})
			.returning();
		if (!first) throw new Error('first seed insert returned no row');

		const [second] = await db
			.insert(imageStyle)
			.values({
				slug,
				name: 'Corrected Name',
				description: 'Corrected description.',
				promptModifier: 'corrected modifier',
				examplePath: '/style-examples/corrected.webp',
				sortOrder: 42
			})
			.onConflictDoUpdate({
				target: imageStyle.slug,
				set: {
					name: 'Corrected Name',
					description: 'Corrected description.',
					promptModifier: 'corrected modifier',
					examplePath: '/style-examples/corrected.webp',
					sortOrder: 42
				}
			})
			.returning();
		if (!second) throw new Error('second seed insert returned no row');

		expect(second.id).toBe(first.id);

		const rows = await db.select().from(imageStyle).where(eq(imageStyle.slug, slug));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name: 'Corrected Name',
			description: 'Corrected description.',
			promptModifier: 'corrected modifier',
			sortOrder: 42
		});

		await db.delete(imageStyle).where(eq(imageStyle.slug, slug));
	});

	it('the six shipped presets from migration 0048 exist exactly once each', async () => {
		const slugs = [
			'ink-wash',
			'woodcut',
			'painterly-fantasy',
			'parchment-sketch',
			'stained-glass',
			'low-poly-diorama'
		];
		for (const slug of slugs) {
			const rows = await db.select().from(imageStyle).where(eq(imageStyle.slug, slug));
			expect(rows).toHaveLength(1);
			expect(rows[0]?.universeId).toBeNull();
		}
	});
});

describe('entryStyleContext resolves a preset (queries/media.ts, issue #407, decision S2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	// `resolveStyle` (packages/media/src/style.ts) is `pickStyle(await entryStyleContext(db,
	// entityId))`, and packages/db must never depend on @canonry/media (see queries/
	// models.ts's own doc comment) - so this proves the half of that pipeline this
	// package owns: with no entry-level override, entryStyleContext's
	// universeStyleModifier is exactly the preset's prompt_modifier once the universe
	// points at one. pickStyle's cascade is a pure passthrough of this same field and is
	// already covered on its own in packages/media/src/style.test.ts, which also proves
	// the same scenario end to end through resolveStyle itself.
	it('a universe pointing at a preset resolves that preset as the universe style, with no entry override', async () => {
		const u = await insertHomebrewUniverse(db);
		const [e] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'character',
				name: 'Test Subject',
				slug: unique('subject')
			})
			.returning();
		if (!e) throw new Error('entity insert returned no row');

		const [preset] = await db
			.select({ id: imageStyle.id, promptModifier: imageStyle.promptModifier })
			.from(imageStyle)
			.where(eq(imageStyle.slug, 'ink-wash'))
			.limit(1);
		if (!preset) throw new Error('ink-wash preset not seeded');

		await selectUniverseImageStylePreset(db, u.id, preset.id);

		const context = await entryStyleContext(db, e.id);
		expect(context?.entityOverride).toBeNull();
		expect(context?.universeStyleModifier).toBe(preset.promptModifier);
	});
});

describe('deleteMediaAsset (queries/media.ts, issue #385)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('removes the row and returns it', async () => {
		const u = await insertHomebrewUniverse(db);
		const created = await createMediaAsset(db, {
			universeId: u.id,
			kind: 'image',
			path: '/media/delete-query-test.png',
			mimeType: 'image/png',
			bytes: 64
		});

		const deleted = await deleteMediaAsset(db, created.id);
		expect(deleted.id).toBe(created.id);
		expect(deleted.path).toBe(created.path);

		expect(await mediaAssetById(db, created.id)).toBeUndefined();
	});

	it('throws for an id that does not exist, rather than silently doing nothing', async () => {
		await expect(deleteMediaAsset(db, randomUUID())).rejects.toThrow();
	});
});
