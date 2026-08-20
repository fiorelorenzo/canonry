/**
 * Issue #378, decision R3: the two new actions this page grew, run against the real
 * exported `actions.setImageStyle`/`actions.setLoremasterVoice` (same technique as
 * `admin/models/params-merge.test.ts` and `review/[proposal]/review.test.ts`) rather than
 * re-deriving what they do, so a route-wiring regression fails here even though
 * `upsertUniverseImageStyle` itself is unit tested directly in `packages/db/test/
 * media.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, isNull, type Db } from '@canonry/db';
import { imageStyle, universe, universeMember, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UniverseSetupItem } from '$lib/server/universe-setup';
import { actions, load } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// `$lib/server/db.ts`'s `db()` singleton, which the actions under test call, reads
// `env.DATABASE_URL` with no fallback of its own - same convention as every other
// integration test in this file's own directory tree.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function postEvent(
	universeSlug: string,
	locals: App.Locals,
	fields: Record<string, string>
): Parameters<typeof actions.setImageStyle>[0] {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return {
		params: { universe: universeSlug },
		locals,
		request: new Request('http://localhost/w/x/settings', { method: 'POST', body: formData })
	} as Parameters<typeof actions.setImageStyle>[0];
}

describe('/w/[universe]/settings actions (issue #378, decision R3)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 3 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture(role: 'owner' | 'viewer' = 'owner') {
		const owner = await db
			.insert(user)
			.values({
				id: unique('settings-user'),
				name: 'Settings Owner',
				email: `${unique('s')}@canonry.invalid`
			})
			.returning();
		const ownerRow = owner[0];
		if (!ownerRow) throw new Error('user insert returned no row');

		const [world] = await db
			.insert(universe)
			.values({
				name: 'Settings World',
				slug: unique('settings-world'),
				ownerUserId: ownerRow.id,
				kind: 'homebrew'
			})
			.returning();
		if (!world) throw new Error('universe insert returned no row');

		let actingUser = ownerRow;
		if (role === 'viewer') {
			const viewer = await db
				.insert(user)
				.values({
					id: unique('settings-viewer'),
					name: 'Settings Viewer',
					email: `${unique('v')}@canonry.invalid`
				})
				.returning();
			const viewerRow = viewer[0];
			if (!viewerRow) throw new Error('user insert returned no row');
			await db
				.insert(universeMember)
				.values({ universeId: world.id, userId: viewerRow.id, role: 'viewer' });
			actingUser = viewerRow;
		}

		const locals = {
			user: { id: actingUser.id, name: actingUser.name, email: actingUser.email },
			locale: 'en'
		} as App.Locals;
		return { world, locals };
	}

	it('setImageStyle inserts one image_style row and points universe.image_style_id at it', async () => {
		const { world, locals } = await fixture();

		const result = await actions.setImageStyle(
			postEvent(world.slug, locals, {
				name: 'Woodcut',
				promptModifier: 'monochrome woodcut, heavy crosshatching'
			})
		);
		expect(result).toMatchObject({
			imageStyleName: 'Woodcut',
			imageStyleModifier: 'monochrome woodcut, heavy crosshatching'
		});

		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.imageStyleId).toBeTruthy();

		const styleRows = await db.select().from(imageStyle).where(eq(imageStyle.universeId, world.id));
		expect(styleRows).toHaveLength(1);
		expect(styleRows[0]).toMatchObject({
			id: row?.imageStyleId,
			name: 'Woodcut',
			promptModifier: 'monochrome woodcut, heavy crosshatching'
		});
	});

	it('a second save updates the same image_style row in place rather than accumulating a second one', async () => {
		const { world, locals } = await fixture();

		await actions.setImageStyle(
			postEvent(world.slug, locals, { name: 'Woodcut', promptModifier: 'monochrome woodcut' })
		);
		const [firstRow] = await db.select().from(universe).where(eq(universe.id, world.id));
		const firstStyleId = firstRow?.imageStyleId;

		await actions.setImageStyle(
			postEvent(world.slug, locals, {
				name: 'Ink wash',
				promptModifier: 'loose ink wash, visible brush strokes'
			})
		);
		const [secondRow] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(secondRow?.imageStyleId).toBe(firstStyleId);

		const styleRows = await db.select().from(imageStyle).where(eq(imageStyle.universeId, world.id));
		expect(styleRows).toHaveLength(1);
		expect(styleRows[0]).toMatchObject({
			name: 'Ink wash',
			promptModifier: 'loose ink wash, visible brush strokes'
		});
	});

	it('setImageStyle rejects an empty name without writing anything', async () => {
		const { world, locals } = await fixture();

		const result = await actions.setImageStyle(
			postEvent(world.slug, locals, { name: '  ', promptModifier: 'anything' })
		);
		expect(result).toMatchObject({ status: 400 });

		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.imageStyleId).toBeNull();
	});

	it('a viewer cannot set the image style', async () => {
		const { world, locals } = await fixture('viewer');

		await expect(
			actions.setImageStyle(
				postEvent(world.slug, locals, { name: 'Woodcut', promptModifier: 'monochrome woodcut' })
			)
		).rejects.toMatchObject({ status: 403 });
	});

	// Issue #407, decision S2.
	it('selectImageStylePreset points the universe at a shipped preset without writing a new row', async () => {
		const { world, locals } = await fixture();
		const [preset] = await db
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(isNull(imageStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded preset to test against');

		const result = await actions.selectImageStylePreset(
			postEvent(world.slug, locals, { presetId: preset.id })
		);
		expect(result).toMatchObject({ selectedPresetId: preset.id });

		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.imageStyleId).toBe(preset.id);

		// No universe-owned row was ever created - the universe only ever points at the
		// preset itself.
		const ownRows = await db.select().from(imageStyle).where(eq(imageStyle.universeId, world.id));
		expect(ownRows).toHaveLength(0);
	});

	it('selectImageStylePreset rejects an id that is not a real preset', async () => {
		const { world, locals } = await fixture();

		const result = await actions.selectImageStylePreset(
			postEvent(world.slug, locals, { presetId: randomUUID() })
		);
		expect(result).toMatchObject({ status: 400 });

		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.imageStyleId).toBeNull();
	});

	it('a viewer cannot pick a preset', async () => {
		const { world, locals } = await fixture('viewer');
		const [preset] = await db
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(isNull(imageStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded preset to test against');

		await expect(
			actions.selectImageStylePreset(postEvent(world.slug, locals, { presetId: preset.id }))
		).rejects.toMatchObject({ status: 403 });
	});

	it('picking a preset does not disturb an existing custom style row, and saving custom afterward never edits the preset', async () => {
		const { world, locals } = await fixture();
		await actions.setImageStyle(
			postEvent(world.slug, locals, { name: 'My Style', promptModifier: 'my own look' })
		);
		const [customRow] = await db
			.select()
			.from(imageStyle)
			.where(eq(imageStyle.universeId, world.id));
		if (!customRow) throw new Error('custom row was not created');

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

		await actions.selectImageStylePreset(postEvent(world.slug, locals, { presetId: preset.id }));

		// The universe now points at the preset, and the GM's own row survived untouched.
		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.imageStyleId).toBe(preset.id);
		const [customAfter] = await db.select().from(imageStyle).where(eq(imageStyle.id, customRow.id));
		expect(customAfter).toMatchObject({ name: 'My Style', promptModifier: 'my own look' });

		// Saving the custom card again switches back to it, and the preset itself is
		// still exactly what it was.
		await actions.setImageStyle(
			postEvent(world.slug, locals, {
				name: 'My Style Revised',
				promptModifier: 'my own look, revised'
			})
		);
		const [rowAfter] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(rowAfter?.imageStyleId).toBe(customRow.id);
		const [presetAfter] = await db.select().from(imageStyle).where(eq(imageStyle.id, preset.id));
		expect(presetAfter).toMatchObject({ name: preset.name, promptModifier: preset.promptModifier });
	});

	it('setLoremasterVoice persists a description and an empty save clears it back to the column default', async () => {
		const { world, locals } = await fixture();

		const voice = 'Wry, understated, never more than a sentence at a time.';
		const result = await actions.setLoremasterVoice(
			postEvent(world.slug, locals, { description: voice })
		);
		expect(result).toEqual({ loremasterDescription: voice });

		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.loremasterDescription).toBe(voice);

		const cleared = await actions.setLoremasterVoice(
			postEvent(world.slug, locals, { description: '' })
		);
		expect(cleared).toEqual({ loremasterDescription: '' });
		const [clearedRow] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(clearedRow?.loremasterDescription).toBe('');
	});

	it('setLoremasterVoice rejects a description over 500 characters without writing it', async () => {
		const { world, locals } = await fixture();

		const tooLong = 'x'.repeat(501);
		const result = await actions.setLoremasterVoice(
			postEvent(world.slug, locals, { description: tooLong })
		);
		expect(result).toMatchObject({ status: 400 });

		const [row] = await db.select().from(universe).where(eq(universe.id, world.id));
		expect(row?.loremasterDescription).toBe('');
	});

	it('a viewer cannot set the Loremaster voice', async () => {
		const { world, locals } = await fixture('viewer');

		await expect(
			actions.setLoremasterVoice(postEvent(world.slug, locals, { description: 'anything' }))
		).rejects.toMatchObject({ status: 403 });
	});
});

// Issue #406 (S1, DECISIONS.md "Round fourteen"): `setupItems` no longer feeds a
// checklist card - `+page.svelte`'s rail turns the same payload into a mark on
// whichever group row owns the unset item instead. The payload's own contract
// (ids, `done`, what counts as unset) is unchanged, so these assertions stay put.
describe('/w/[universe]/settings load: setupItems (issue #379 R4, issue #406 S1)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 3 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture() {
		const [owner] = await db
			.insert(user)
			.values({
				id: unique('checklist-user'),
				name: 'Checklist Owner',
				email: `${unique('c')}@canonry.invalid`
			})
			.returning();
		if (!owner) throw new Error('user insert returned no row');

		const [world] = await db
			.insert(universe)
			.values({
				name: 'Checklist World',
				slug: unique('checklist-world'),
				ownerUserId: owner.id,
				kind: 'homebrew'
			})
			.returning();
		if (!world) throw new Error('universe insert returned no row');

		const locals = {
			user: { id: owner.id, name: owner.name, email: owner.email },
			locale: 'en'
		} as App.Locals;
		return { world, locals };
	}

	// Same technique as `p/leak.test.ts`'s own `loadUniverseLayout` helper: calling a
	// generated `PageServerLoad` directly infers a `void | (...)` union, since the
	// type accounts for a route that never returns - cast to the one field this file
	// reads instead of fighting that inference.
	async function loadFor(
		slug: string,
		locals: App.Locals
	): Promise<{ setupItems: UniverseSetupItem[] }> {
		const result = await load({ params: { universe: slug }, locals } as Parameters<typeof load>[0]);
		return result as { setupItems: UniverseSetupItem[] };
	}

	it('lists both items unset for a freshly created universe', async () => {
		const { world, locals } = await fixture();
		const data = await loadFor(world.slug, locals);
		expect(data.setupItems).toEqual([
			{ id: 'imageStyle', done: false },
			{ id: 'loremasterVoice', done: false }
		]);
	});

	it('drops an item once its action saves it, in the same load a page after the redirect would run', async () => {
		const { world, locals } = await fixture();

		await actions.setImageStyle(
			postEvent(world.slug, locals, { name: 'Woodcut', promptModifier: 'monochrome woodcut' })
		);
		await actions.setLoremasterVoice(
			postEvent(world.slug, locals, { description: 'Wry, understated.' })
		);

		const data = await loadFor(world.slug, locals);
		expect(data.setupItems.every((item) => item.done)).toBe(true);
	});
});

// Issue #407, decision S2: the picker's own load fields.
describe('/w/[universe]/settings load: image style picker (issue #407, decision S2)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 3 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture() {
		const [owner] = await db
			.insert(user)
			.values({
				id: unique('picker-user'),
				name: 'Picker Owner',
				email: `${unique('p')}@canonry.invalid`
			})
			.returning();
		if (!owner) throw new Error('user insert returned no row');

		const [world] = await db
			.insert(universe)
			.values({
				name: 'Picker World',
				slug: unique('picker-world'),
				ownerUserId: owner.id,
				kind: 'homebrew'
			})
			.returning();
		if (!world) throw new Error('universe insert returned no row');

		const locals = {
			user: { id: owner.id, name: owner.name, email: owner.email },
			locale: 'en'
		} as App.Locals;
		return { world, locals };
	}

	async function loadFor(
		slug: string,
		locals: App.Locals
	): Promise<{
		imageStylePresets: Array<{ id: string; slug: string; name: string }>;
		currentImageStyleId: string | null;
		imageStyleName: string;
		imageStyleModifier: string;
	}> {
		const result = await load({ params: { universe: slug }, locals } as Parameters<typeof load>[0]);
		return result as {
			imageStylePresets: Array<{ id: string; slug: string; name: string }>;
			currentImageStyleId: string | null;
			imageStyleName: string;
			imageStyleModifier: string;
		};
	}

	it('lists the six shipped presets and no current selection for a freshly created universe', async () => {
		const { world, locals } = await fixture();
		const data = await loadFor(world.slug, locals);
		expect(data.imageStylePresets.length).toBeGreaterThanOrEqual(6);
		expect(data.imageStylePresets.some((p) => p.slug === 'ink-wash')).toBe(true);
		expect(data.currentImageStyleId).toBeNull();
		expect(data.imageStyleName).toBe('');
	});

	it('after picking a preset, currentImageStyleId matches it and the custom form stays blank', async () => {
		const { world, locals } = await fixture();
		const [preset] = await db
			.select({ id: imageStyle.id })
			.from(imageStyle)
			.where(isNull(imageStyle.universeId))
			.limit(1);
		if (!preset) throw new Error('no seeded preset to test against');

		await actions.selectImageStylePreset(postEvent(world.slug, locals, { presetId: preset.id }));

		const data = await loadFor(world.slug, locals);
		expect(data.currentImageStyleId).toBe(preset.id);
		// The custom card's own form never prefills from a preset - it has nothing of
		// its own to show until the GM saves one.
		expect(data.imageStyleName).toBe('');
		expect(data.imageStyleModifier).toBe('');
	});
});
