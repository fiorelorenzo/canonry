/**
 * Issue #451, decision U2, on #407's own model (test/media.test.ts). Query-level coverage
 * for the shipped narration catalogue and a universe's own custom voice; the migration's
 * own data-carry-forward (an existing `loremaster_description` surviving into a custom
 * row) is `test/migration-0050.test.ts`'s job, since that needs a database state this
 * package's shared test database no longer has once migration 0050 has already run.
 */
import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	listNarrationStylePresets,
	loremasterVoiceClauseForUniverse,
	NarrationStylePresetNotFoundError,
	selectUniverseNarrationStylePreset,
	upsertUniverseNarrationStyle,
	type Db
} from '../src/index.js';
import { narrationStyle } from '../src/schema/narration.js';
import { universe } from '../src/schema/universe.js';
import { insertHomebrewUniverse, testDb, unique } from './helpers.js';

describe('listNarrationStylePresets (queries/narration.ts, issue #451, decision U2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('returns the shipped catalogue in English by default, ordered by sort_order, with an example sentence per preset', async () => {
		const presets = await listNarrationStylePresets(db, 'en');
		expect(presets.length).toBeGreaterThanOrEqual(4);
		const warm = presets.find((p) => p.slug === 'warm-companion');
		expect(warm).toMatchObject({ name: 'Warm Companion' });
		expect(warm?.description.length).toBeGreaterThan(0);
		expect(warm?.promptClause.length).toBeGreaterThan(0);
		expect(warm?.exampleSentence.length).toBeGreaterThan(0);

		const sortOrders = presets.map((p) => p.sortOrder);
		expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
	});

	it('returns the Italian translation when asked for it, but never translates the prompt clause, and translates the example sentence too (issue #796)', async () => {
		const presets = await listNarrationStylePresets(db, 'it');
		const warm = presets.find((p) => p.slug === 'warm-companion');
		expect(warm?.name).toBe('Compagno Caloroso');
		expect(warm?.name).not.toBe('Warm Companion');

		const english = await listNarrationStylePresets(db, 'en');
		const warmEnglish = english.find((p) => p.slug === 'warm-companion');
		expect(warm?.promptClause).toBe(warmEnglish?.promptClause);
		expect(warm?.exampleSentence.length).toBeGreaterThan(0);
		expect(warm?.exampleSentence).not.toBe(warmEnglish?.exampleSentence);
	});

	it('falls back to the English row, example sentence included, for a locale with no translation', async () => {
		const presets = await listNarrationStylePresets(db, 'fr');
		const warm = presets.find((p) => p.slug === 'warm-companion');
		expect(warm?.name).toBe('Warm Companion');
		const english = await listNarrationStylePresets(db, 'en');
		const warmEnglish = english.find((p) => p.slug === 'warm-companion');
		expect(warm?.exampleSentence).toBe(warmEnglish?.exampleSentence);
	});

	it('never includes a universe-owned custom row', async () => {
		const u = await insertHomebrewUniverse(db);
		await upsertUniverseNarrationStyle(db, {
			universeId: u.id,
			name: 'Should Never Appear In The Catalogue',
			promptClause: 'anything'
		});
		const presets = await listNarrationStylePresets(db, 'en');
		expect(presets.some((p) => p.name === 'Should Never Appear In The Catalogue')).toBe(false);
	});
});

describe('selectUniverseNarrationStylePreset (queries/narration.ts, issue #451, decision U2)', () => {
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
			.select({ id: narrationStyle.id })
			.from(narrationStyle)
			.where(isNull(narrationStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded narration preset to test against');

		await selectUniverseNarrationStylePreset(db, u.id, preset.id);
		const [row] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(row?.narrationStyleId).toBe(preset.id);
	});

	it('refuses a target id that does not exist', async () => {
		const u = await insertHomebrewUniverse(db);
		await expect(selectUniverseNarrationStylePreset(db, u.id, randomUUID())).rejects.toThrow(
			NarrationStylePresetNotFoundError
		);
	});

	it("refuses another universe's custom row, so a GM cannot point their universe at a private voice by guessing its id", async () => {
		const owner = await insertHomebrewUniverse(db);
		const ownersCustomVoice = await upsertUniverseNarrationStyle(db, {
			universeId: owner.id,
			name: 'Owner Only',
			promptClause: 'private'
		});

		const attacker = await insertHomebrewUniverse(db);
		await expect(
			selectUniverseNarrationStylePreset(db, attacker.id, ownersCustomVoice.id)
		).rejects.toThrow(NarrationStylePresetNotFoundError);

		const [attackerRow] = await db.select().from(universe).where(eq(universe.id, attacker.id));
		expect(attackerRow?.narrationStyleId).toBeNull();
	});

	it('throws for a universe id that does not exist', async () => {
		const [preset] = await db
			.select({ id: narrationStyle.id })
			.from(narrationStyle)
			.where(isNull(narrationStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded narration preset to test against');
		await expect(selectUniverseNarrationStylePreset(db, randomUUID(), preset.id)).rejects.toThrow();
	});
});

describe('upsertUniverseNarrationStyle (queries/narration.ts, issue #451, decision U2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('inserts one narration_style row and points universe.narration_style_id at it, then updates the same row in place on a second save', async () => {
		const u = await insertHomebrewUniverse(db);

		const first = await upsertUniverseNarrationStyle(db, {
			universeId: u.id,
			name: 'Dry Archivist',
			promptClause: 'dry and formal'
		});
		const [rowAfterFirst] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(rowAfterFirst?.narrationStyleId).toBe(first.id);

		const second = await upsertUniverseNarrationStyle(db, {
			universeId: u.id,
			name: 'Warm Companion (my own)',
			promptClause: 'warm and encouraging'
		});
		expect(second.id).toBe(first.id);

		const rows = await db.select().from(narrationStyle).where(eq(narrationStyle.universeId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name: 'Warm Companion (my own)',
			promptClause: 'warm and encouraging'
		});
	});

	it('issue #451: never edits a preset a universe currently points at - saving a custom voice creates the universe its own row instead', async () => {
		const u = await insertHomebrewUniverse(db);
		const [preset] = await db
			.select({
				id: narrationStyle.id,
				name: narrationStyle.name,
				promptClause: narrationStyle.promptClause
			})
			.from(narrationStyle)
			.where(isNull(narrationStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded narration preset to test against');

		await selectUniverseNarrationStylePreset(db, u.id, preset.id);
		const [pointed] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(pointed?.narrationStyleId).toBe(preset.id);

		const custom = await upsertUniverseNarrationStyle(db, {
			universeId: u.id,
			name: 'My Own Voice',
			promptClause: 'my own words'
		});

		// The preset itself never changed.
		const [presetAfter] = await db
			.select()
			.from(narrationStyle)
			.where(eq(narrationStyle.id, preset.id));
		expect(presetAfter).toMatchObject({ name: preset.name, promptClause: preset.promptClause });

		// A new, separate row belongs to this universe, and the universe now points at it.
		expect(custom.id).not.toBe(preset.id);
		expect(custom.universeId).toBe(u.id);
		const [row] = await db.select().from(universe).where(eq(universe.id, u.id));
		expect(row?.narrationStyleId).toBe(custom.id);
	});
});

describe('narration_style presets: re-seed in place (migration 0050, issue #451, decision U2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	// Exercises the exact mechanism migration 0050's `ON CONFLICT ("slug") DO UPDATE`
	// depends on - the `slug` unique constraint schema/narration.ts declares - against a
	// throwaway slug rather than one of the shipped presets, for the same reason
	// media.test.ts's own equivalent avoids the real image style catalogue.
	it('a second insert with the same slug updates the row in place and never duplicates it', async () => {
		const slug = unique('reseed-narration-preset');

		const [first] = await db
			.insert(narrationStyle)
			.values({
				slug,
				name: 'Draft Voice',
				description: 'Draft description.',
				promptClause: 'draft clause',
				exampleSentence: 'A draft sentence.',
				sortOrder: 99
			})
			.onConflictDoUpdate({
				target: narrationStyle.slug,
				set: {
					name: 'Draft Voice',
					description: 'Draft description.',
					promptClause: 'draft clause',
					exampleSentence: 'A draft sentence.',
					sortOrder: 99
				}
			})
			.returning();
		if (!first) throw new Error('first seed insert returned no row');

		const [second] = await db
			.insert(narrationStyle)
			.values({
				slug,
				name: 'Corrected Voice',
				description: 'Corrected description.',
				promptClause: 'corrected clause',
				exampleSentence: 'A corrected sentence.',
				sortOrder: 42
			})
			.onConflictDoUpdate({
				target: narrationStyle.slug,
				set: {
					name: 'Corrected Voice',
					description: 'Corrected description.',
					promptClause: 'corrected clause',
					exampleSentence: 'A corrected sentence.',
					sortOrder: 42
				}
			})
			.returning();
		if (!second) throw new Error('second seed insert returned no row');

		expect(second.id).toBe(first.id);

		const rows = await db.select().from(narrationStyle).where(eq(narrationStyle.slug, slug));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name: 'Corrected Voice',
			description: 'Corrected description.',
			promptClause: 'corrected clause',
			sortOrder: 42
		});

		await db.delete(narrationStyle).where(eq(narrationStyle.slug, slug));
	});

	it('the shipped presets from migration 0050 exist exactly once each', async () => {
		const slugs = [
			'warm-companion',
			'dry-archivist',
			'grim-chronicler',
			'hype-herald',
			'plainspoken-neighbor'
		];
		for (const slug of slugs) {
			const rows = await db.select().from(narrationStyle).where(eq(narrationStyle.slug, slug));
			expect(rows).toHaveLength(1);
			expect(rows[0]?.universeId).toBeNull();
		}
	});
});

describe('loremasterVoiceClauseForUniverse (queries/narration.ts, issue #451, decision U2)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('is empty for a universe with no voice chosen', async () => {
		const u = await insertHomebrewUniverse(db);
		expect(await loremasterVoiceClauseForUniverse(db, u.id)).toBe('');
	});

	it("resolves a chosen preset's own clause", async () => {
		const u = await insertHomebrewUniverse(db);
		const [preset] = await db
			.select({ id: narrationStyle.id, promptClause: narrationStyle.promptClause })
			.from(narrationStyle)
			.where(eq(narrationStyle.slug, 'grim-chronicler'))
			.limit(1);
		if (!preset) throw new Error('grim-chronicler preset not seeded');

		await selectUniverseNarrationStylePreset(db, u.id, preset.id);
		expect(await loremasterVoiceClauseForUniverse(db, u.id)).toBe(preset.promptClause);
	});

	it("resolves a universe's own custom row", async () => {
		const u = await insertHomebrewUniverse(db);
		await upsertUniverseNarrationStyle(db, {
			universeId: u.id,
			name: 'Custom',
			promptClause: 'a voice nobody else has'
		});
		expect(await loremasterVoiceClauseForUniverse(db, u.id)).toBe('a voice nobody else has');
	});
});
