/**
 * Issue #385, decision R10: the delete none of the three old media surfaces had a place
 * for. Calls the real exported `DELETE` handler directly (same technique as
 * `../upload/upload.test.ts`), against the real dev Postgres and the real
 * `FilesystemMediaStorage` behind `$lib/server/media.ts`'s `mediaStorage()` singleton.
 *
 * The two refusals are the point of this file. `entity.cover_asset_id` is `onDelete: 'set
 * null'` (packages/db/src/schema/entity.ts), which would quietly heal a dangling
 * reference if this route ever let one through - the cover case below proves the route
 * never gets that far, rather than trusting the fk to clean up after it. The in-body case
 * proves the same for a reference living in `entity.body`, which has no fk at all.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, mediaAsset, universe, universeMember, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaStorage } from '$lib/server/media';
import { DELETE } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reasoning as leak.test.ts and upload.test.ts: $lib/server/db.ts's db() singleton
// reads env.DATABASE_URL with no fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// A 1x1 transparent PNG - the same fixture upload.test.ts and packages/media/src/
// provider.ts's tinyPngBytes encode, so a stored file under test is real bytes rather
// than an empty placeholder.
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function pngBytes(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, 'base64'));
}

async function storeAndAttach(db: Db, universeId: string, entityId: string): Promise<string> {
	const bytes = pngBytes();
	const stored = await mediaStorage().save({
		universeId,
		kind: 'image',
		mimeType: 'image/png',
		bytes
	});
	const [row] = await db
		.insert(mediaAsset)
		.values({
			universeId,
			entityId,
			kind: 'image',
			path: stored.path,
			mimeType: 'image/png',
			bytes: stored.bytes,
			generated: false
		})
		.returning();
	if (!row) throw new Error('media_asset insert did not return a row');
	return row.id;
}

async function fileExists(relativePath: string): Promise<boolean> {
	try {
		await mediaStorage().read(relativePath);
		return true;
	} catch {
		return false;
	}
}

describe('DELETE .../media/[id] (#385)', () => {
	let db: Db;
	let ownerId: string;
	let viewerId: string;
	let universeId: string;
	let universeSlug: string;
	let entityId: string;
	let entitySlug: string;
	let plainAssetId: string;
	let coverAssetId: string;
	let inBodyAssetId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		ownerId = unique('media-delete-test-owner');
		await db
			.insert(user)
			.values({ id: ownerId, name: 'Delete Test Owner', email: `${ownerId}@example.test` });

		viewerId = unique('media-delete-test-viewer');
		await db
			.insert(user)
			.values({ id: viewerId, name: 'Delete Test Viewer', email: `${viewerId}@example.test` });

		universeSlug = unique('media-delete-test-universe');
		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Delete Test Universe',
				slug: universeSlug,
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;

		await db.insert(universeMember).values([
			{ universeId, userId: ownerId, role: 'owner' },
			{ universeId, userId: viewerId, role: 'viewer' }
		]);

		entitySlug = unique('delete-test-entity');
		const [ent] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Delete Test Subject',
				slug: entitySlug,
				body: 'placeholder'
			})
			.returning();
		if (!ent) throw new Error('entity insert did not return a row');
		entityId = ent.id;

		plainAssetId = await storeAndAttach(db, universeId, entityId);
		coverAssetId = await storeAndAttach(db, universeId, entityId);
		inBodyAssetId = await storeAndAttach(db, universeId, entityId);

		await db.update(entity).set({ coverAssetId }).where(eq(entity.id, entityId));

		const inBodyUrl = `/w/${universeSlug}/e/${entitySlug}/media/${inBodyAssetId}`;
		await db
			.update(entity)
			.set({ body: `An image is here: ![the subject](${inBodyUrl} =50%) and some more prose.` })
			.where(eq(entity.id, entityId));
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await db.delete(user).where(eq(user.id, viewerId));
		await closeDb(db);
	});

	function deleteEvent(assetId: string, asUserId: string): Parameters<typeof DELETE>[0] {
		return {
			request: new Request(`http://localhost/w/x/e/y/media/${assetId}`, { method: 'DELETE' }),
			params: { universe: universeSlug, slug: entitySlug, id: assetId },
			locals: { user: { id: asUserId }, locale: 'en' }
		} as Parameters<typeof DELETE>[0];
	}

	async function expectRefusal(assetId: string, asUserId: string, status: number): Promise<void> {
		let caught: unknown;
		try {
			await DELETE(deleteEvent(assetId, asUserId));
		} catch (err) {
			caught = err;
		}
		if (!isHttpError(caught)) throw new Error(`expected an HttpError with status ${status}`);
		expect(caught.status).toBe(status);
	}

	it('requires the writer role', async () => {
		await expectRefusal(plainAssetId, viewerId, 403);

		// Nothing moved: the row and the file are both still there.
		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, plainAssetId));
		expect(row).toBeDefined();
		expect(await fileExists(row!.path)).toBe(true);
	});

	it("refuses to delete the entry's cover, and proves cover_asset_id never dangles", async () => {
		await expectRefusal(coverAssetId, ownerId, 409);

		// The row survives, the file survives, and the fk this route exists to make
		// unnecessary was never even asked to fire.
		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, coverAssetId));
		expect(row).toBeDefined();
		expect(await fileExists(row!.path)).toBe(true);

		const [current] = await db.select().from(entity).where(eq(entity.id, entityId));
		expect(current?.coverAssetId).toBe(coverAssetId);
	});

	it('refuses to delete an image still referenced in the body', async () => {
		await expectRefusal(inBodyAssetId, ownerId, 409);

		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, inBodyAssetId));
		expect(row).toBeDefined();
		expect(await fileExists(row!.path)).toBe(true);

		const [current] = await db.select().from(entity).where(eq(entity.id, entityId));
		expect(current?.body).toContain(inBodyAssetId);
	});

	it('deletes the row and the stored file for a writer, on an image that is neither the cover nor referenced', async () => {
		const [before] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, plainAssetId));
		expect(before).toBeDefined();
		expect(await fileExists(before!.path)).toBe(true);

		const res = await DELETE(deleteEvent(plainAssetId, ownerId));
		expect(res.status).toBe(200);
		const data = (await res.json()) as { id: string };
		expect(data.id).toBe(plainAssetId);

		const [after] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, plainAssetId));
		expect(after).toBeUndefined();
		expect(await fileExists(before!.path)).toBe(false);

		// The entry's real cover, set on a different asset, is untouched by an unrelated
		// delete - the two refusals above and this success are not the same code path
		// wearing different clothes.
		const [current] = await db.select().from(entity).where(eq(entity.id, entityId));
		expect(current?.coverAssetId).toBe(coverAssetId);
	});
});
