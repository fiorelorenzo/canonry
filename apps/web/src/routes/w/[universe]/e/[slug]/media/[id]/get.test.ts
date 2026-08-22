/**
 * `GET .../media/[id]` and the state nobody had a case for: the row is there and the file
 * is not. That is what a database restored without its media directory looks like, and
 * what a storage root moved out from under a running app looks like, and the route used to
 * answer 500 for it, so every `<img>` pointing at one logged a server error on every
 * render of the page carrying it.
 *
 * Same technique as `delete.test.ts`: the real exported handler, the real dev Postgres,
 * the real `FilesystemMediaStorage` behind `$lib/server/media.ts`. The missing-file case
 * stores a real file, reads it back to prove the happy path, then deletes the bytes
 * underneath the row rather than faking a storage error, because the point is the state
 * and not the exception.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, mediaAsset, universe, universeMember, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaStorage } from '$lib/server/media';
import { GET } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('GET .../media/[id]', () => {
	let db: Db;
	let ownerId: string;
	let universeId: string;
	let universeSlug: string;
	let entitySlug: string;
	let assetId: string;
	let assetPath: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		ownerId = unique('media-get-test-owner');
		await db
			.insert(user)
			.values({ id: ownerId, name: 'Get Test Owner', email: `${ownerId}@example.test` });

		universeSlug = unique('media-get-test-universe');
		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Get Test Universe',
				slug: universeSlug,
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		await db.insert(universeMember).values({ universeId, userId: ownerId, role: 'owner' });

		entitySlug = unique('get-test-entity');
		const [ent] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Get Test Subject',
				slug: entitySlug,
				body: 'placeholder'
			})
			.returning();
		if (!ent) throw new Error('entity insert did not return a row');

		const bytes = Uint8Array.from(Buffer.from(TINY_PNG_BASE64, 'base64'));
		const stored = await mediaStorage().save({
			universeId,
			kind: 'image',
			mimeType: 'image/png',
			bytes
		});
		assetPath = stored.path;
		const [row] = await db
			.insert(mediaAsset)
			.values({
				universeId,
				entityId: ent.id,
				kind: 'image',
				path: stored.path,
				mimeType: 'image/png',
				bytes: stored.bytes,
				generated: false
			})
			.returning();
		if (!row) throw new Error('media_asset insert did not return a row');
		assetId = row.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	function getEvent(id: string): Parameters<typeof GET>[0] {
		return {
			request: new Request(`http://localhost/w/x/e/y/media/${id}`),
			params: { universe: universeSlug, slug: entitySlug, id },
			locals: { user: { id: ownerId }, locale: 'en' }
		} as Parameters<typeof GET>[0];
	}

	async function expectStatus(id: string, status: number): Promise<void> {
		let caught: unknown;
		try {
			await GET(getEvent(id));
		} catch (err) {
			caught = err;
		}
		if (!isHttpError(caught)) throw new Error(`expected an HttpError with status ${status}`);
		expect(caught.status).toBe(status);
	}

	it('serves the stored bytes with the asset\u2019s own mime type', async () => {
		const response = await GET(getEvent(assetId));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.length).toBeGreaterThan(0);
		// The PNG magic number, so this is the file that was stored and not an empty body.
		expect([...body.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('answers 404 for an id this universe does not have', async () => {
		await expectStatus('00000000-0000-0000-0000-000000000000', 404);
	});

	it('answers 404, not 500, when the row is there and the bytes are gone', async () => {
		// The state a restore without its media directory leaves behind. Delete the file
		// underneath the row, which is exactly what the route has to survive.
		await mediaStorage().delete(assetPath);
		await expectStatus(assetId, 404);

		// The row itself is untouched: this route reports what it found, it does not tidy up.
		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId));
		expect(row).toBeDefined();
		expect(row?.path).toBe(assetPath);
	});
});
