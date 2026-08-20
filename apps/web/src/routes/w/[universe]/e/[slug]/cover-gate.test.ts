/**
 * Round eleven P6 (#347), the half of it that a refactor can break without anybody
 * noticing: the cover placeholder is for somebody who can write to the world, and for
 * nobody else.
 *
 * O2 refused a placeholder because a reader would be shown an invitation they cannot
 * accept, and P6 reverses that only for a writer, so "who is asking" is not styling, it is
 * the decision itself. This file asserts it at both ends:
 *
 * 1. `coverSlot` over its whole input space, since that function is where the rule lives
 *    and a page's `{#if}` is where it would otherwise be re-derived by hand.
 * 2. The real `load` of this route, called as an owner and then as a viewer of the same
 *    universe and the same entry, so the `canWrite` the gate reads is the one the server
 *    actually resolves from a role rather than a value a test made up. That is what makes
 *    this a proof about HTML: the placeholder is mounted from server data, so a viewer
 *    whose `canWrite` is false cannot be sent one, with or without CSS.
 *
 * The players' wiki needs no case here because it cannot reach this code: `/p/` imports
 * `EntryCover` and never `EntryCoverPlaceholder`, and `p/leak.test.ts` already guards what
 * that route ships.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, mediaAsset, universe, universeMember, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverSlot } from '$lib/components/media/cover-crop';
import { load as loadEntry } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reason `p/leak.test.ts` does this: the route's own `$lib/server/db.ts` singleton
// reads `$env/dynamic/private` with no fallback, and it has to be set before the first
// `load` call rather than inside one.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('the cover slot (round eleven P6, #347)', () => {
	it('gives a writer a placeholder only when there is no cover', () => {
		expect(coverSlot({ coverAssetId: null, canWrite: true })).toBe('placeholder');
		expect(coverSlot({ coverAssetId: 'asset-1', canWrite: true })).toBe('band');
	});

	it('never gives a reader a placeholder, which is the half of O2 that survives', () => {
		expect(coverSlot({ coverAssetId: null, canWrite: false })).toBe('none');
	});

	it('still shows a reader the band when there is a real cover', () => {
		expect(coverSlot({ coverAssetId: 'asset-1', canWrite: false })).toBe('band');
	});
});

describe('the entry loader resolves the gate from a role', () => {
	let db: Db;
	let ownerId: string;
	let viewerId: string;
	let universeSlug: string;
	let bareSlug: string;
	let coveredSlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('cover-gate-owner');
		const viewerKey = unique('cover-gate-viewer');
		const [owner, viewer] = await db
			.insert(user)
			.values([
				{ id: ownerKey, name: 'Cover Gate Owner', email: `${ownerKey}@example.test` },
				{ id: viewerKey, name: 'Cover Gate Viewer', email: `${viewerKey}@example.test` }
			])
			.returning({ id: user.id });
		if (!owner || !viewer) throw new Error('user insert did not return two rows');
		ownerId = owner.id;
		viewerId = viewer.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Cover Gate Universe',
				slug: unique('cover-gate-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeSlug = uni.slug;

		// A viewer, not a member with a writing role: 'viewer' is the one role `canWrite`
		// answers false for, and it is exactly the reader O2 was protecting.
		await db
			.insert(universeMember)
			.values({ universeId: uni.id, userId: viewerId, role: 'viewer' });

		const [bare, covered] = await db
			.insert(entity)
			.values([
				{
					universeId: uni.id,
					type: 'character',
					name: 'Nobody Painted Her Yet',
					slug: unique('bare'),
					body: 'An entry with no cover, which is the case the placeholder exists for.'
				},
				{
					universeId: uni.id,
					type: 'place',
					name: 'A Place With A Picture',
					slug: unique('covered'),
					body: 'An entry that already has a cover, so both roles get the band.'
				}
			])
			.returning({ id: entity.id, slug: entity.slug });
		if (!bare || !covered) throw new Error('entity insert did not return two rows');
		bareSlug = bare.slug;
		coveredSlug = covered.slug;

		const [asset] = await db
			.insert(mediaAsset)
			.values({
				universeId: uni.id,
				entityId: covered.id,
				kind: 'image',
				mimeType: 'image/png',
				path: `/media/${unique('cover')}.png`,
				generated: false
			})
			.returning({ id: mediaAsset.id });
		if (!asset) throw new Error('media asset insert did not return a row');
		await db.update(entity).set({ coverAssetId: asset.id }).where(eq(entity.id, covered.id));
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function loadAs(userId: string, slug: string) {
		return (await loadEntry({
			params: { universe: universeSlug, slug },
			locals: { user: { id: userId }, locale: 'en' }
		} as Parameters<typeof loadEntry>[0])) as {
			media: { canWrite: boolean };
			entity: { coverAssetId: string | null };
		};
	}

	it('sends an owner of an uncovered entry a placeholder', async () => {
		const data = await loadAs(ownerId, bareSlug);
		expect(data.media.canWrite).toBe(true);
		expect(
			coverSlot({ coverAssetId: data.entity.coverAssetId, canWrite: data.media.canWrite })
		).toBe('placeholder');
	});

	it('sends a viewer of the same entry nothing at all', async () => {
		const data = await loadAs(viewerId, bareSlug);
		expect(data.media.canWrite).toBe(false);
		expect(
			coverSlot({ coverAssetId: data.entity.coverAssetId, canWrite: data.media.canWrite })
		).toBe('none');
	});

	it('sends both of them the band once a cover exists', async () => {
		for (const userId of [ownerId, viewerId]) {
			const data = await loadAs(userId, coveredSlug);
			expect(data.entity.coverAssetId).not.toBeNull();
			expect(
				coverSlot({ coverAssetId: data.entity.coverAssetId, canWrite: data.media.canWrite })
			).toBe('band');
		}
	});
});
