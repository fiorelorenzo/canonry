/**
 * Issue #408, decision S3: with no image style set, generation used to run anyway and
 * inherit nothing (pickStyle() falling through to `{ modifier: null, source: 'none' }`).
 * This route now refuses before calling generateImages at all - a 409 with a reason the
 * client can render, in the shape the route's other refusals already take (see the
 * AiDisabledError branch this mirrors).
 *
 * Calls the real exported `POST` handlers directly (same technique as
 * `../upload/upload.test.ts` and `../[id]/delete.test.ts`), against the real dev Postgres
 * and the real `FilesystemMediaStorage` behind `$lib/server/media.ts`'s `mediaStorage()`
 * singleton - see upload.test.ts's own header for why there is no injection seam for that
 * one. `generatePOST`/`uploadPOST` are static imports, not dynamic ones: Vitest hoists
 * every `vi.mock` call below above every import in this file regardless of where either is
 * written, the same ordering `$lib/server/onboarding.test.ts` already relies on.
 *
 * `imageProvider`/`embeddingProviderFor`/`similarityDeps` are mocked to
 * `FakeImageProvider`/`FakeEmbeddingProvider`/a plain `SimilarityCacheDeps` built the same
 * way `packages/media/src/generate.test.ts` builds its own - `$lib/server/media.ts`'s
 * `imageProvider()` is deliberately always the real Replicate one (see that file's own
 * header), and this worktree carries no REPLICATE_API_TOKEN, so proving a "succeeds once a
 * style is set" case needs a fake wired in at the module boundary, not a real credential
 * this environment does not have.
 *
 * `image_model_config` is a global singleton (#193) shared with
 * `routes/admin/models/{aspect-ratio-guard,params-merge}.test.ts`, which already reserve
 * the `scene` feature for exactly this kind of cross-file coordination - this file takes
 * the same advisory lock and drives the same feature rather than adding a second contended
 * row.
 */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, createDb, eq, sql, type Db } from '@canonry/db';
import {
	entity,
	imageModelConfig,
	imageStyle,
	mediaAsset,
	universe,
	universeMember,
	user
} from '@canonry/db/schema';
import {
	createVectorClient,
	FakeEmbeddingProvider,
	FakeImageProvider,
	mediaSimilarityCollectionName
} from '@canonry/media';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { messages } from '$lib/i18n';
import type * as Media from '$lib/server/media';
import { POST as generatePOST } from './+server.js';
import { POST as uploadPOST } from '../upload/+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reasoning as leak.test.ts and upload.test.ts: $lib/server/db.ts's db() singleton
// reads env.DATABASE_URL with no fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

vi.mock('$lib/server/media', async (importOriginal) => {
	const actual = await importOriginal<typeof Media>();
	return {
		...actual,
		// mediaStorage stays real - upload's own test proves that seam already, and this
		// file's upload assertions below reuse it exactly as production does.
		imageProvider: () => new FakeImageProvider(),
		embeddingProviderFor: () => new FakeEmbeddingProvider(),
		similarityDeps: async () => ({
			client: createVectorClient(),
			vectorSize: 256,
			collection: mediaSimilarityCollectionName('fake', 'trigram')
		})
	};
});

const MEDIA_ROOT = path.join(process.cwd(), '.data', 'media');

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// A 1x1 transparent PNG - the same fixture upload.test.ts and packages/media/src/
// provider.ts's tinyPngBytes encode.
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function pngBytes(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, 'base64'));
}

async function rowsForUniverse(db: Db, universeId: string) {
	return db.select().from(mediaAsset).where(eq(mediaAsset.universeId, universeId));
}

describe('POST .../media/generate (#408)', () => {
	let db: Db;
	let userId: string;

	let noStyleUniverseId: string;
	let noStyleUniverseSlug: string;
	let noStyleEntitySlug: string;

	let styledUniverseId: string;
	let styledUniverseSlug: string;
	let styledEntitySlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		// #193: exclusive control of image_model_config's one active `scene` row for the
		// duration of this file's run, same convention as the two /admin/models suites that
		// already reserve this feature for the same reason.
		await db.execute(sql`select pg_advisory_lock(hashtext('image_model_config'), 0)`);
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, 'scene'));
		await db.insert(imageModelConfig).values({
			feature: 'scene',
			provider: 'replicate',
			modelId: 'canonry-web-test-scene',
			active: true,
			params: { pricePerImage: 0.005, currency: 'USD', aspectRatio: '16:9' }
		});

		userId = unique('media-generate-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Generate Test Owner', email: `${userId}@example.test` });

		// A universe with no image style at all - the seeded world's own state.
		noStyleUniverseSlug = unique('media-generate-test-nostyle');
		const [noStyleWorld] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'No Style Universe',
				slug: noStyleUniverseSlug,
				kind: 'homebrew'
			})
			.returning();
		if (!noStyleWorld) throw new Error('no-style universe insert did not return a row');
		noStyleUniverseId = noStyleWorld.id;
		await db
			.insert(universeMember)
			.values({ universeId: noStyleUniverseId, userId, role: 'owner' });

		noStyleEntitySlug = unique('aldric-vane-nostyle');
		await db.insert(entity).values({
			universeId: noStyleUniverseId,
			type: 'character',
			name: 'Aldric Vane',
			slug: noStyleEntitySlug,
			body: 'Dismissed watch captain, lean and grey-coated.'
		});

		// A universe with a real image_style row, pointed at by universe.image_style_id -
		// the same shape decision S3 says generation may run against.
		styledUniverseSlug = unique('media-generate-test-styled');
		const [styledWorld] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Styled Universe',
				slug: styledUniverseSlug,
				kind: 'homebrew'
			})
			.returning();
		if (!styledWorld) throw new Error('styled universe insert did not return a row');
		styledUniverseId = styledWorld.id;
		await db.insert(universeMember).values({ universeId: styledUniverseId, userId, role: 'owner' });

		const [style] = await db
			.insert(imageStyle)
			.values({
				universeId: styledUniverseId,
				name: 'House style',
				promptModifier: 'ink and wash, muted, cold light'
			})
			.returning();
		if (!style) throw new Error('image_style insert did not return a row');
		await db
			.update(universe)
			.set({ imageStyleId: style.id })
			.where(eq(universe.id, styledUniverseId));

		styledEntitySlug = unique('corvin-ashe-styled');
		await db.insert(entity).values({
			universeId: styledUniverseId,
			type: 'character',
			name: 'Corvin Ashe',
			slug: styledEntitySlug,
			body: 'Retired duelist, silver-haired, keeps to the harbour district.'
		});
	});

	afterAll(async () => {
		await rm(path.join(MEDIA_ROOT, noStyleUniverseId), { recursive: true, force: true });
		await rm(path.join(MEDIA_ROOT, styledUniverseId), { recursive: true, force: true });
		await db.delete(universe).where(eq(universe.id, noStyleUniverseId));
		await db.delete(universe).where(eq(universe.id, styledUniverseId));
		await db.delete(user).where(eq(user.id, userId));
		await db.delete(imageModelConfig).where(eq(imageModelConfig.feature, 'scene'));
		await db.execute(sql`select pg_advisory_unlock(hashtext('image_model_config'), 0)`);
		await closeDb(db);
	});

	function generateEvent(
		body: Record<string, unknown>,
		opts: { universeSlug: string; entitySlug: string; asUserId?: string }
	): Parameters<typeof generatePOST>[0] {
		return {
			request: new Request('http://localhost/w/x/e/y/media/generate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			}),
			params: { universe: opts.universeSlug, slug: opts.entitySlug },
			locals: { user: { id: opts.asUserId ?? userId }, locale: 'en' }
		} as Parameters<typeof generatePOST>[0];
	}

	function uploadEvent(
		file: File,
		opts: { universeSlug: string; entitySlug: string; asUserId?: string }
	): Parameters<typeof uploadPOST>[0] {
		const form = new FormData();
		form.set('file', file);
		return {
			request: new Request('http://localhost/w/x/e/y/media/upload', { method: 'POST', body: form }),
			params: { universe: opts.universeSlug, slug: opts.entitySlug },
			locals: { user: { id: opts.asUserId ?? userId }, locale: 'en' }
		} as Parameters<typeof uploadPOST>[0];
	}

	it('refuses with 409 and creates nothing when the universe has no image style set', async () => {
		const before = await rowsForUniverse(db, noStyleUniverseId);

		let caught: unknown;
		try {
			await generatePOST(
				generateEvent(
					{ feature: 'scene' },
					{ universeSlug: noStyleUniverseSlug, entitySlug: noStyleEntitySlug }
				)
			);
		} catch (err) {
			caught = err;
		}
		if (!isHttpError(caught)) throw new Error('expected an HttpError with status 409');
		expect(caught.status).toBe(409);
		// Proves it is *this* refusal and not some other 409 (AiDisabledError, which this
		// universe's aiEnabled: true default rules out anyway) - the message is the one
		// #408 added, media namespace only.
		expect(caught.body.message).toBe(messages('en').entry.media.noStyle.notice);

		expect(await rowsForUniverse(db, noStyleUniverseId)).toHaveLength(before.length);
	});

	it('generates once the universe has an image style set', async () => {
		const before = await rowsForUniverse(db, styledUniverseId);

		const res = await generatePOST(
			generateEvent(
				{ feature: 'scene' },
				{ universeSlug: styledUniverseSlug, entitySlug: styledEntitySlug }
			)
		);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { assets: Array<{ id: string }> };
		expect(data.assets.length).toBeGreaterThan(0);

		const after = await rowsForUniverse(db, styledUniverseId);
		expect(after.length).toBe(before.length + data.assets.length);
		const generatedRow = after.find((row) => row.id === data.assets[0]?.id);
		expect(generatedRow?.generated).toBe(true);
	});

	it('uploads successfully with no image style set', async () => {
		const before = await rowsForUniverse(db, noStyleUniverseId);

		const res = await uploadPOST(
			uploadEvent(new File([pngBytes()], 'portrait.png', { type: 'image/png' }), {
				universeSlug: noStyleUniverseSlug,
				entitySlug: noStyleEntitySlug
			})
		);
		expect(res.status).toBe(200);
		const asset = (await res.json()) as { generated: boolean };
		expect(asset.generated).toBe(false);

		expect(await rowsForUniverse(db, noStyleUniverseId)).toHaveLength(before.length + 1);
	});

	it('uploads successfully with an image style set too', async () => {
		const before = await rowsForUniverse(db, styledUniverseId);

		const res = await uploadPOST(
			uploadEvent(new File([pngBytes()], 'portrait.png', { type: 'image/png' }), {
				universeSlug: styledUniverseSlug,
				entitySlug: styledEntitySlug
			})
		);
		expect(res.status).toBe(200);
		const asset = (await res.json()) as { generated: boolean };
		expect(asset.generated).toBe(false);

		expect(await rowsForUniverse(db, styledUniverseId)).toHaveLength(before.length + 1);
	});
});
