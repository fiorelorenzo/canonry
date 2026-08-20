/**
 * Real Postgres, real filesystem, real image bytes throughout (issue #40, SPEC.md §6.3,
 * §6.6) - no mocked `Db`, no fabricated PNG/JPEG bytes. `small.png` and `oversized.png`
 * are real, fully decodable PNGs generated with Node's own `zlib`; `photo.jpg` is the
 * actual scanned-page image `pdfimages` extracted from `test/fixtures/pdf/handout.pdf`;
 * `export-with-image.zip` is a real zip carrying that same JPEG, read here with the real
 * `ArchiveSourceReader` (issue #25) - not a hand-rolled zip reader standing in for it.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, eq, sql, type Db } from '@canonry/db';
import { mediaAsset, universe, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArchiveSourceReader } from './archive.js';
import {
	DEFAULT_MEDIA_STORE_LIMITS,
	ImageDecodeError,
	ImageDimensionsTooLargeError,
	ImageTooLargeError,
	MediaAssetImageStore
} from './media-store.js';
import { openTestDb } from './test-db.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../test/fixtures/media/', import.meta.url));

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('MediaAssetImageStore (issue #40, SPEC.md §6.3, §6.6)', () => {
	let db: Db;
	let mediaRoot: string;
	let universeId: string;

	beforeAll(async () => {
		db = openTestDb();
		mediaRoot = await mkdtemp(path.join(tmpdir(), 'canonry-import-media-test-'));

		const userId = unique('media-store-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Media Store Test Owner', email: `${userId}@example.test` });

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Media Store Test Universe',
				slug: unique('media-store-test-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;
	});

	afterAll(async () => {
		await rm(mediaRoot, { recursive: true, force: true });
		await closeDb(db);
	});

	it('stores a real PNG under the media root and inserts an unattached, gm_only-false, non-generated media_asset row', async () => {
		const bytes = await readFile(`${FIXTURE_ROOT}small.png`);
		const store = new MediaAssetImageStore({ db, universeId, mediaRoot });

		const { assetId } = await store.store({
			sourcePath: 'images/small.png',
			mimeType: 'image/png',
			base64: bytes.toString('base64')
		});

		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId));
		if (!row) throw new Error('media_asset row missing after store()');

		expect(row.universeId).toBe(universeId);
		expect(row.entityId).toBeNull();
		expect(row.kind).toBe('image');
		expect(row.mimeType).toBe('image/png');
		expect(row.bytes).toBe(bytes.byteLength);
		expect(row.generated).toBe(false);
		// Guardrail 6 (#382's cousin for imports): stays false, but the row is unattached
		// (entityId null) until a human attaches it - the default alone never leaks it.
		expect(row.gmOnly).toBe(false);
		expect(row.path.startsWith(universeId)).toBe(true);

		const onDisk = await readFile(path.join(mediaRoot, row.path));
		expect(onDisk.equals(bytes)).toBe(true);
	});

	it('stores the file rather than referencing it - deleting the "source" afterwards leaves the stored copy readable', async () => {
		const sourceBytes = await readFile(`${FIXTURE_ROOT}photo.jpg`);
		const sourceCopy = await mkdtemp(path.join(tmpdir(), 'canonry-import-source-'));
		const sourceFile = path.join(sourceCopy, 'photo.jpg');
		await writeFile(sourceFile, sourceBytes);

		const store = new MediaAssetImageStore({ db, universeId, mediaRoot });
		const { assetId } = await store.store({
			sourcePath: sourceFile,
			mimeType: 'image/jpeg',
			base64: sourceBytes.toString('base64')
		});

		// The "export" this image came from is gone now - store() already copied the bytes.
		await rm(sourceCopy, { recursive: true, force: true });

		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId));
		if (!row) throw new Error('media_asset row missing after store()');
		const stillReadable = await readFile(path.join(mediaRoot, row.path));
		expect(stillReadable.equals(sourceBytes)).toBe(true);
	});

	it('reads a real image out of a real zip archive and stores it', async () => {
		const zipBytes = await readFile(`${FIXTURE_ROOT}export-with-image.zip`);
		const archive = ArchiveSourceReader.open(zipBytes);
		const binary = await archive.readBinary('images/photo.jpg');
		const extracted = Buffer.from(binary.base64, 'base64');
		const onDiskDirect = await readFile(`${FIXTURE_ROOT}photo.jpg`);
		expect(extracted.equals(onDiskDirect)).toBe(true);
		expect(binary.mimeType).toBe('image/jpeg');

		const store = new MediaAssetImageStore({ db, universeId, mediaRoot });
		const { assetId } = await store.store({
			sourcePath: 'images/photo.jpg',
			mimeType: 'image/jpeg',
			base64: extracted.toString('base64')
		});

		const [row] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId));
		expect(row?.bytes).toBe(extracted.byteLength);
		expect(row?.mimeType).toBe('image/jpeg');
	});

	it('refuses a real oversized image (header declares 42,000,000 pixels) with a named error, before ever writing a file or a row', async () => {
		const bytes = await readFile(`${FIXTURE_ROOT}oversized.png`);
		const store = new MediaAssetImageStore({ db, universeId, mediaRoot });

		const rowsBefore = await db.select({ count: sql<number>`count(*)::int` }).from(mediaAsset);
		const before = rowsBefore[0]?.count ?? 0;

		await expect(
			store.store({
				sourcePath: 'images/oversized.png',
				mimeType: 'image/png',
				base64: bytes.toString('base64')
			})
		).rejects.toThrow(ImageDimensionsTooLargeError);

		const rowsAfter = await db.select({ count: sql<number>`count(*)::int` }).from(mediaAsset);
		const after = rowsAfter[0]?.count ?? 0;
		expect(after).toBe(before);
	});

	it('refuses a file over the byte-size limit with a named error, using real bytes and a real (scoped-down) limit', async () => {
		const bytes = await readFile(`${FIXTURE_ROOT}photo.jpg`);
		const store = new MediaAssetImageStore({
			db,
			universeId,
			mediaRoot,
			limits: { ...DEFAULT_MEDIA_STORE_LIMITS, maxBytes: 1000 }
		});

		await expect(
			store.store({
				sourcePath: 'images/photo.jpg',
				mimeType: 'image/jpeg',
				base64: bytes.toString('base64')
			})
		).rejects.toThrow(ImageTooLargeError);
	});

	it('refuses a truncated/corrupt file that still claims to be a known raster format', async () => {
		// A real PNG signature with no IHDR chunk behind it - the header a decoder would
		// need to even know its own dimensions is simply not there.
		const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
		const store = new MediaAssetImageStore({ db, universeId, mediaRoot });

		await expect(
			store.store({
				sourcePath: 'images/broken.png',
				mimeType: 'image/png',
				base64: corrupt.toString('base64')
			})
		).rejects.toThrow(ImageDecodeError);
	});
});
