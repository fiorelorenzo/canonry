/**
 * Issue #252. Calls the real exported `POST` handler directly (same technique as
 * `../../../../../../admin/models/params-merge.test.ts` and `../../../../../../p/leak.test.ts`),
 * against the real dev Postgres and the real `FilesystemMediaStorage` behind
 * `$lib/server/media.ts`'s `mediaStorage()` singleton - there is no injection seam to swap
 * that for a temp directory (the singleton is memoised on first call, and `MEDIA_ROOT` is
 * read through `$env/dynamic/private`, whose dev value is snapshotted by Vite's `loadEnv()`
 * once at config resolution, too early for a test file to override - see vite.config.ts's
 * own comment on the same snapshot timing for `DATABASE_URL`). So this file writes through
 * the same default root the dev server itself uses when `MEDIA_ROOT` is unset
 * (`readMediaRoot`'s fallback, `<cwd>/.data/media`) and cleans up the one universe-scoped
 * subdirectory it touches in `afterAll`, the same way it deletes its own DB rows.
 *
 * No `image_model_config`/`model_config` row is read or written anywhere in this file -
 * nothing this endpoint does calls a model - so none of #193's advisory-lock dance applies.
 */
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, mediaAsset, universe, universeMember, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reasoning as leak.test.ts and params-merge.test.ts: $lib/server/db.ts's db()
// singleton reads env.DATABASE_URL with no fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

const MEDIA_ROOT = path.join(process.cwd(), '.data', 'media');

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// A 1x1 transparent PNG - real magic number, real IHDR/IDAT/IEND chunks, the same fixture
// packages/media/src/provider.ts's tinyPngBytes encodes. Duplicated rather than imported:
// apps/web does not otherwise depend on @canonry/media's test-only export for one constant.
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
// The buffer parameter is spelled out because a bare `Uint8Array` means
// `Uint8Array<ArrayBufferLike>`, which is not a `BlobPart`, so `new File([bytes], ...)`
// below would not typecheck: `ArrayBufferLike` admits a `SharedArrayBuffer`, and a Blob
// cannot be built from shared memory.
function pngBytes(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, 'base64'));
}

async function imageFileNames(universeId: string): Promise<string[]> {
	try {
		return await readdir(path.join(MEDIA_ROOT, universeId, 'image'));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
}

async function rowsFor(db: Db, entityId: string) {
	return db.select().from(mediaAsset).where(eq(mediaAsset.entityId, entityId));
}

describe('POST .../media/upload (#252)', () => {
	let db: Db;
	let userId: string;
	let universeId: string;
	let universeSlug: string;
	let entityId: string;
	let entitySlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		userId = unique('media-upload-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Upload Test Owner', email: `${userId}@example.test` });

		universeSlug = unique('media-upload-test-universe');
		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Upload Test Universe',
				slug: universeSlug,
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;

		await db.insert(universeMember).values({ universeId, userId, role: 'owner' });

		entitySlug = unique('upload-test-entity');
		const [ent] = await db
			.insert(entity)
			.values({ universeId, type: 'character', name: 'Upload Test Subject', slug: entitySlug })
			.returning();
		if (!ent) throw new Error('entity insert did not return a row');
		entityId = ent.id;
	});

	afterAll(async () => {
		await rm(path.join(MEDIA_ROOT, universeId), { recursive: true, force: true });
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	function uploadEvent(file: File | undefined, asUserId = userId): Parameters<typeof POST>[0] {
		const form = new FormData();
		if (file) form.set('file', file);
		return {
			request: new Request('http://localhost/w/x/e/y/media/upload', { method: 'POST', body: form }),
			params: { universe: universeSlug, slug: entitySlug },
			locals: { user: { id: asUserId }, locale: 'en' }
		} as Parameters<typeof POST>[0];
	}

	async function expectRefusal(
		file: File | undefined,
		status: number,
		asUserId = userId
	): Promise<void> {
		let caught: unknown;
		try {
			await POST(uploadEvent(file, asUserId));
		} catch (err) {
			caught = err;
		}
		if (!isHttpError(caught)) throw new Error(`expected an HttpError with status ${status}`);
		expect(caught.status).toBe(status);
	}

	it('creates one media_asset row with generated: false, a matching byte count, and gm_only false', async () => {
		const bytes = pngBytes();
		const before = await rowsFor(db, entityId);

		const res = await POST(uploadEvent(new File([bytes], 'portrait.png', { type: 'image/png' })));
		expect(res.status).toBe(200);
		const data = (await res.json()) as { id: string; mimeType: string; generated: boolean };
		expect(data.mimeType).toBe('image/png');
		expect(data.generated).toBe(false);

		const after = await rowsFor(db, entityId);
		expect(after.length).toBe(before.length + 1);
		const row = after.find((r) => r.id === data.id);
		expect(row).toBeDefined();
		expect(row?.generated).toBe(false);
		// The load-bearing distinction the issue names: an uploaded file must not borrow
		// the marks that say a model made it.
		expect(row?.prompt).toBeNull();
		expect(row?.provider).toBeNull();
		expect(row?.modelId).toBeNull();
		expect(row?.bytes).toBe(bytes.byteLength);
		expect(row?.entityId).toBe(entityId);
		expect(row?.kind).toBe('image');
		// Guardrail 6: createMediaAsset does not accept gmOnly as an input, so this can
		// only ever be the schema default.
		expect(row?.gmOnly).toBe(false);
	});

	it('refuses a disallowed mime type and stores nothing', async () => {
		const bytesBefore = await imageFileNames(universeId);
		const rowsBefore = await rowsFor(db, entityId);

		const notAnImage = new TextEncoder().encode('this is plain text, not an image at all');
		await expectRefusal(new File([notAnImage], 'fake.png', { type: 'image/png' }), 415);

		expect(await imageFileNames(universeId)).toEqual(bytesBefore);
		expect(await rowsFor(db, entityId)).toHaveLength(rowsBefore.length);
	});

	it('refuses a file over the byte ceiling and stores nothing', async () => {
		const bytesBefore = await imageFileNames(universeId);
		const rowsBefore = await rowsFor(db, entityId);

		// One byte over the endpoint's 25MB ceiling - content does not matter, `File.size`
		// alone is enough to refuse before a single byte is read into memory.
		const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
		await expectRefusal(new File([oversized], 'huge.png', { type: 'image/png' }), 413);

		expect(await imageFileNames(universeId)).toEqual(bytesBefore);
		expect(await rowsFor(db, entityId)).toHaveLength(rowsBefore.length);
	});

	it('refuses a file whose declared type disagrees with its actual bytes and stores nothing', async () => {
		const bytesBefore = await imageFileNames(universeId);
		const rowsBefore = await rowsFor(db, entityId);

		// Real PNG bytes, declared as a JPEG - the sniffed format and the declared
		// content-type disagree, which is refused even though the bytes alone are a
		// perfectly valid, allowed image.
		await expectRefusal(new File([pngBytes()], 'photo.jpg', { type: 'image/jpeg' }), 415);

		expect(await imageFileNames(universeId)).toEqual(bytesBefore);
		expect(await rowsFor(db, entityId)).toHaveLength(rowsBefore.length);
	});

	it('refuses a request with no file and stores nothing', async () => {
		const rowsBefore = await rowsFor(db, entityId);
		await expectRefusal(undefined, 400);
		expect(await rowsFor(db, entityId)).toHaveLength(rowsBefore.length);
	});

	it('requires the writer role', async () => {
		const viewerId = unique('media-upload-test-viewer');
		await db
			.insert(user)
			.values({ id: viewerId, name: 'Upload Test Viewer', email: `${viewerId}@example.test` });
		await db.insert(universeMember).values({ universeId, userId: viewerId, role: 'viewer' });

		try {
			await expectRefusal(
				new File([pngBytes()], 'portrait.png', { type: 'image/png' }),
				403,
				viewerId
			);
		} finally {
			await db.delete(universeMember).where(eq(universeMember.userId, viewerId));
			await db.delete(user).where(eq(user.id, viewerId));
		}
	});
});
