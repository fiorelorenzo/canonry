import { randomUUID } from 'node:crypto';
import { closeDb, eq, type Db } from '@canonry/db';
import { entity, imageStyle, universe, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntryNotFoundError, pickStyle, resolveStyle } from './style.js';
import { openTestDb } from './test-db.js';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('pickStyle (#65, pure)', () => {
	it('the entry override wins when set', () => {
		const style = pickStyle({
			entityOverride: 'photorealistic',
			universeStyleModifier: 'ink and wash'
		});
		expect(style).toEqual({ modifier: 'photorealistic', source: 'entry' });
	});

	it('an explicit empty-string override still wins - it means "no style for this entry"', () => {
		const style = pickStyle({ entityOverride: '', universeStyleModifier: 'ink and wash' });
		expect(style).toEqual({ modifier: '', source: 'entry' });
	});

	it('falls back to the universe style when the entry has no override (null)', () => {
		const style = pickStyle({ entityOverride: null, universeStyleModifier: 'ink and wash' });
		expect(style).toEqual({ modifier: 'ink and wash', source: 'universe' });
	});

	it('resolves to no style when neither the entry nor the universe has one', () => {
		const style = pickStyle({ entityOverride: null, universeStyleModifier: null });
		expect(style).toEqual({ modifier: null, source: 'none' });
	});
});

describe('resolveStyle (#65, against the real database)', () => {
	let db: Db;
	let universeId: string;
	let userId: string;
	let overriddenEntityId: string;
	let inheritingEntityId: string;

	beforeAll(async () => {
		db = openTestDb();
		userId = unique('media-style-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Style Test Owner', email: `${userId}@example.test` });

		const [style] = await db
			.insert(imageStyle)
			.values({ name: 'House style', promptModifier: 'ink and wash, muted, cold light' })
			.returning();
		if (!style) throw new Error('image_style insert did not return a row');

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Style Test Universe',
				slug: unique('media-style-test-universe'),
				kind: 'homebrew',
				imageStyleId: style.id
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;

		const rows = await db
			.insert(entity)
			.values([
				{
					universeId,
					type: 'character',
					name: 'Aldric Vane',
					slug: 'aldric-vane',
					imagePromptModifier: 'photorealistic, dramatic lighting'
				},
				{
					universeId,
					type: 'place',
					name: 'The Gilded Rat',
					slug: 'the-gilded-rat',
					imagePromptModifier: null
				}
			])
			.returning();
		const overridden = rows.find((r) => r.slug === 'aldric-vane');
		const inheriting = rows.find((r) => r.slug === 'the-gilded-rat');
		if (!overridden || !inheriting) throw new Error('entity insert did not return both rows');
		overriddenEntityId = overridden.id;
		inheritingEntityId = inheriting.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	it('the per-entry override wins over the universe style (#65 acceptance)', async () => {
		const style = await resolveStyle(db, overriddenEntityId);
		expect(style).toEqual({ modifier: 'photorealistic, dramatic lighting', source: 'entry' });
	});

	it('every other entry inherits the universe-level style modifier', async () => {
		const style = await resolveStyle(db, inheritingEntityId);
		expect(style).toEqual({ modifier: 'ink and wash, muted, cold light', source: 'universe' });
	});

	it('throws for an entity that does not exist', async () => {
		await expect(resolveStyle(db, randomUUID())).rejects.toThrow(EntryNotFoundError);
	});
});

// Issue #407, decision S2: a universe may now point at a shipped preset
// (`universe_id IS NULL`, migration 0048) instead of only ever a per-universe custom
// row - resolveStyle must not care which kind of image_style row it is reading, since
// pickStyle's cascade only ever looks at the resolved modifier string.
describe('resolveStyle resolves a shipped preset (#407, decision S2, against the real database)', () => {
	let db: Db;
	let universeId: string;
	let userId: string;
	let entityId: string;

	beforeAll(async () => {
		db = openTestDb();
		userId = unique('media-style-preset-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Preset Style Test Owner', email: `${userId}@example.test` });

		const [preset] = await db
			.select({ id: imageStyle.id, promptModifier: imageStyle.promptModifier })
			.from(imageStyle)
			.where(eq(imageStyle.slug, 'ink-wash'))
			.limit(1);
		if (!preset) throw new Error('ink-wash preset not seeded - migration 0048 did not run');

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Preset Style Test Universe',
				slug: unique('media-style-preset-test-universe'),
				kind: 'homebrew',
				imageStyleId: preset.id
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;

		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'No Override',
				slug: unique('no-override'),
				imagePromptModifier: null
			})
			.returning();
		if (!row) throw new Error('entity insert did not return a row');
		entityId = row.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	it("a universe pointing at a preset resolves that preset's own prompt modifier as the universe style", async () => {
		const [preset] = await db
			.select({ promptModifier: imageStyle.promptModifier })
			.from(imageStyle)
			.where(eq(imageStyle.slug, 'ink-wash'))
			.limit(1);
		if (!preset) throw new Error('ink-wash preset not seeded');

		const style = await resolveStyle(db, entityId);
		expect(style).toEqual({ modifier: preset.promptModifier, source: 'universe' });
	});
});
