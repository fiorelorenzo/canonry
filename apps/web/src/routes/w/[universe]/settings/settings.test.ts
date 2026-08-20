/**
 * Issue #378, decision R3: the two new actions this page grew, run against the real
 * exported `actions.setImageStyle`/`actions.setLoremasterVoice` (same technique as
 * `admin/models/params-merge.test.ts` and `review/[proposal]/review.test.ts`) rather than
 * re-deriving what they do, so a route-wiring regression fails here even though
 * `upsertUniverseImageStyle` itself is unit tested directly in `packages/db/test/
 * media.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { imageStyle, universe, universeMember, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions } from './+page.server.js';

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
