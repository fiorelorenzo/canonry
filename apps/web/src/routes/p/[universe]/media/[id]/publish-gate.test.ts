/**
 * #254 acceptance, run against the real `GET` handler: invisible before publish, visible
 * once published, invisible again after unpublish, invisible for a `gm_only` entity even
 * when its image is published, and invisible for a published image whose entity carries
 * no confirmed revelation. Real Postgres and real bytes on disk through the same
 * `mediaStorage()` singleton the route itself imports (same "read the file back, don't
 * trust a return value" convention `packages/media`'s own generate tests already use),
 * rather than only exercising `publicMediaAssetById` in isolation - the acceptance
 * criteria are about what this route serves, not just what the query returns.
 */
import { randomUUID } from 'node:crypto';
import {
	closeDb,
	createDb,
	eq,
	revealEntityLive,
	setMediaAssetPublished,
	type Db
} from '@canonry/db';
import { entity, mediaAsset, universe, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaStorage } from '$lib/server/media';
import { GET } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same convention as leak.test.ts and lib/server/players.test.ts: `$lib/server/db.ts`'s
// `db()` singleton, which the route under test calls, reads `env.DATABASE_URL` with no
// fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Awaits a `GET` call expected to `error(...)`, and returns the HTTP status it threw -
 * SvelteKit's `error()` throws rather than returning a response, so a plain `await`
 * would otherwise just propagate the exception to the test runner. */
async function statusOf(promise: Response | Promise<Response>): Promise<number> {
	try {
		await promise;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
	throw new Error('expected the request to throw an HTTP error, but it returned a response');
}

describe('GET /p/[universe]/media/[id] (#254)', () => {
	let db: Db;
	let universeRow: { id: string; slug: string };
	let ownerUserId: string;
	let sessionEntityId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });
		const userId = unique('publish-gate-user');
		const [owner] = await db
			.insert(user)
			.values({ id: userId, name: 'Publish Gate Owner', email: `${userId}@example.test` })
			.returning();
		if (!owner) throw new Error('user insert did not return a row');
		ownerUserId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Publish Gate Universe',
				slug: unique('publish-gate-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeRow = uni;

		const [session] = await db
			.insert(entity)
			.values({ universeId: uni.id, type: 'session', name: 'Session 1', slug: unique('session') })
			.returning({ id: entity.id });
		if (!session) throw new Error('session entity insert did not return a row');
		sessionEntityId = session.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeRow.id));
		await db.delete(user).where(eq(user.id, ownerUserId));
		await closeDb(db);
	});

	async function makeEntity(
		overrides: Partial<typeof entity.$inferInsert> = {}
	): Promise<{ id: string }> {
		const [row] = await db
			.insert(entity)
			.values({
				universeId: universeRow.id,
				type: 'character',
				name: 'Publish Gate Character',
				slug: unique('publish-gate-character'),
				body: 'A test character for the publish gate.',
				...overrides
			})
			.returning({ id: entity.id });
		if (!row) throw new Error('entity insert did not return a row');
		return row;
	}

	async function makeAsset(input: {
		entityId: string;
		published: boolean;
		bytes: Uint8Array;
	}): Promise<{ id: string }> {
		const stored = await mediaStorage().save({
			universeId: universeRow.id,
			kind: 'image',
			mimeType: 'image/png',
			bytes: input.bytes
		});
		const [row] = await db
			.insert(mediaAsset)
			.values({
				universeId: universeRow.id,
				entityId: input.entityId,
				kind: 'image',
				path: stored.path,
				mimeType: 'image/png',
				bytes: stored.bytes,
				generated: true,
				publishedToPlayers: input.published
			})
			.returning({ id: mediaAsset.id });
		if (!row) throw new Error('media asset insert did not return a row');
		return row;
	}

	it('is invisible before publish, visible once published, and invisible again after unpublish', async () => {
		const revealed = await makeEntity();
		await revealEntityLive(db, {
			universeId: universeRow.id,
			entityId: revealed.id,
			sessionEntityId
		});

		const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const asset = await makeAsset({ entityId: revealed.id, published: false, bytes });
		const event = { params: { universe: universeRow.slug, id: asset.id } } as Parameters<
			typeof GET
		>[0];

		expect(await statusOf(GET(event))).toBe(404);

		await setMediaAssetPublished(db, asset.id, true);
		const response = await GET(event);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

		await setMediaAssetPublished(db, asset.id, false);
		expect(await statusOf(GET(event))).toBe(404);
	});

	it('stays invisible for a gm_only entity even when its image is published - visibility outranks publication', async () => {
		const gmOnly = await makeEntity({
			visibility: 'gm_only',
			slug: unique('publish-gate-gm-only')
		});
		await revealEntityLive(db, {
			universeId: universeRow.id,
			entityId: gmOnly.id,
			sessionEntityId
		});
		const asset = await makeAsset({
			entityId: gmOnly.id,
			published: true,
			bytes: new Uint8Array([1, 2, 3])
		});

		const event = { params: { universe: universeRow.slug, id: asset.id } } as Parameters<
			typeof GET
		>[0];
		expect(await statusOf(GET(event))).toBe(404);
	});

	it('stays invisible for a published image whose entity carries no confirmed revelation', async () => {
		const unrevealed = await makeEntity({ slug: unique('publish-gate-unrevealed') });
		// Deliberately no revealEntityLive call here.
		const asset = await makeAsset({
			entityId: unrevealed.id,
			published: true,
			bytes: new Uint8Array([4, 5, 6])
		});

		const event = { params: { universe: universeRow.slug, id: asset.id } } as Parameters<
			typeof GET
		>[0];
		expect(await statusOf(GET(event))).toBe(404);
	});

	it('404s for a universe that does not exist, the same as a real 404, no distinguishing signal', async () => {
		const event = {
			params: { universe: unique('no-such-universe'), id: randomUUID() }
		} as Parameters<typeof GET>[0];
		expect(await statusOf(GET(event))).toBe(404);
	});
});
