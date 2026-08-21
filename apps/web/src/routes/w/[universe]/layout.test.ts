/**
 * Issue #379, decision R4 (DECISIONS.md "Round thirteen"): the shell row's own count,
 * read straight off `+layout.server.ts`'s `load` - not `universeSetupItems()` in
 * isolation (that function's own contract is `$lib/server/universe-setup.test.ts`'s
 * job), but the wiring that turns a real universe row into what the sidebar actually
 * receives. `p/leak.test.ts` covers the player-wiki layout separately; this file is
 * the GM shell's own `/w/[universe]/+layout.server.ts`.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, upsertUniverseNarrationStyle, type Db } from '@canonry/db';
import { imageStyle, universe, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UniverseSetupItem } from '$lib/server/universe-setup';
import { load } from './+layout.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same convention as every other integration test in this directory tree: `db()`
// reads `env.DATABASE_URL` with no fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('/w/[universe] layout setupItems (issue #379, decision R4)', () => {
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
				id: unique('layout-user'),
				name: 'Layout Owner',
				email: `${unique('l')}@canonry.invalid`
			})
			.returning();
		if (!owner) throw new Error('user insert returned no row');

		const [world] = await db
			.insert(universe)
			.values({
				name: 'Layout World',
				slug: unique('layout-world'),
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
	// generated `LayoutServerLoad` directly (rather than through SvelteKit's own
	// routing) infers a `void | (...)` union, since the type accounts for a route that
	// never returns - cast the awaited result to the one field this file reads instead
	// of fighting that inference.
	async function loadFor(
		slug: string,
		locals: App.Locals
	): Promise<{ setupItems: UniverseSetupItem[] }> {
		const result = await load({ params: { universe: slug }, locals } as Parameters<typeof load>[0]);
		return result as { setupItems: UniverseSetupItem[] };
	}

	it('carries a count of 2 unset for a freshly created universe - the row this powers shows "2 settings left to finish"', async () => {
		const { world, locals } = await fixture();
		const data = await loadFor(world.slug, locals);
		expect(data.setupItems).toEqual([
			{ id: 'imageStyle', done: false },
			{ id: 'loremasterVoice', done: false }
		]);
		expect(data.setupItems.filter((item) => !item.done)).toHaveLength(2);
	});

	it('drops to 1 unset once only the image style is set', async () => {
		const { world, locals } = await fixture();
		const [style] = await db
			.insert(imageStyle)
			.values({ universeId: world.id, name: 'Woodcut', promptModifier: 'monochrome woodcut' })
			.returning();
		if (!style) throw new Error('image style insert returned no row');
		await db.update(universe).set({ imageStyleId: style.id }).where(eq(universe.id, world.id));

		const data = await loadFor(world.slug, locals);
		expect(data.setupItems.filter((item) => !item.done)).toHaveLength(1);
	});

	it('has nothing unset, and the row this powers disappears, once both are set', async () => {
		const { world, locals } = await fixture();
		const [style] = await db
			.insert(imageStyle)
			.values({ universeId: world.id, name: 'Woodcut', promptModifier: 'monochrome woodcut' })
			.returning();
		if (!style) throw new Error('image style insert returned no row');
		await db.update(universe).set({ imageStyleId: style.id }).where(eq(universe.id, world.id));
		await upsertUniverseNarrationStyle(db, {
			universeId: world.id,
			name: 'Custom',
			promptClause: 'Wry, understated, dry.'
		});

		const data = await loadFor(world.slug, locals);
		expect(data.setupItems.every((item) => item.done)).toBe(true);
		expect(data.setupItems.filter((item) => !item.done)).toHaveLength(0);
	});

	it('never carries the setting values themselves, only ids and booleans', async () => {
		const { world, locals } = await fixture();
		const data = await loadFor(world.slug, locals);
		for (const item of data.setupItems) {
			expect(Object.keys(item).sort()).toEqual(['done', 'id']);
		}
	});
});
