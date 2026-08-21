/**
 * #477: `POST .../table/context` (issue #73/#72's declare route) built its own `pinned`
 * mapping by hand and left the `warm` field off every entry - the shape
 * `PinnedCards.svelte` needs and `+layout.server.ts`'s own initial load already got
 * right. Declaring a place is exactly the moment this route's own JSON response (and the
 * identical object it broadcasts as the SSE `context` event's `pinned`, same payload,
 * same call) reaches the client, so a pin with no `warm` field there is the "Cannot read
 * properties of undefined (reading 'status')" the browser throws the instant a GM
 * declares a place. This calls the real exported `POST` handler (same technique as
 * `../e/[slug]/media/upload/upload.test.ts`) against real Postgres, so a future
 * hand-rolled `pinned.map(...)` here regrows the bug loudly rather than silently.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, relation, relationType, universe, user, warmArtifact } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reasoning as upload.test.ts and players.test.ts: $lib/server/db.ts's db()
// singleton reads env.DATABASE_URL with no fallback of its own, before the first POST.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('POST .../table/context: every declared pin carries a warm status (#477)', () => {
	let db: Db;
	let userId: string;
	let universeId: string;
	let universeSlug: string;
	let placeId: string;
	let warmNeighborId: string;
	let coldNeighborId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		userId = unique('pin-cards-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Pin Cards Test Owner', email: `${userId}@example.test` });

		universeSlug = unique('pin-cards-test-universe');
		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Pin Cards Test Universe',
				slug: universeSlug,
				kind: 'homebrew'
			})
			.returning();
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;

		const [place, warmNeighbor, coldNeighbor] = await db
			.insert(entity)
			.values([
				{ universeId, type: 'place', name: 'Cairnmouth', slug: unique('cairnmouth') },
				{ universeId, type: 'character', name: 'Warm Neighbor', slug: unique('warm-neighbor') },
				{ universeId, type: 'character', name: 'Cold Neighbor', slug: unique('cold-neighbor') }
			])
			.returning();
		if (!place || !warmNeighbor || !coldNeighbor) {
			throw new Error('entity insert did not return every row');
		}
		placeId = place.id;
		warmNeighborId = warmNeighbor.id;
		coldNeighborId = coldNeighbor.id;

		const [relType] = await db
			.insert(relationType)
			.values({
				universeId,
				label: 'found in',
				inverseLabel: 'contains',
				cardinality: 'many_to_many',
				allowedFrom: ['character'],
				allowedTo: ['place']
			})
			.returning({ id: relationType.id });
		if (!relType) throw new Error('relation type insert did not return a row');

		await db.insert(relation).values([
			{
				universeId,
				relationTypeId: relType.id,
				fromEntityId: warmNeighborId,
				toEntityId: placeId,
				authorKind: 'human'
			},
			{
				universeId,
				relationTypeId: relType.id,
				fromEntityId: coldNeighborId,
				toEntityId: placeId,
				authorKind: 'human'
			}
		]);

		// One pin already has a fresh "brief" artifact (PinCard['warm']'s `warm` variant),
		// the other has never been generated (the `cold` variant) - a regression that
		// drops the `warm` field on either shape fails the assertions below.
		await db.insert(warmArtifact).values({
			universeId,
			kind: 'brief',
			subjectEntityId: warmNeighborId,
			payload: { text: 'A brief.' },
			fingerprint: 'test-fingerprint',
			stale: false
		});
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	function declareEvent(): Parameters<typeof POST>[0] {
		return {
			request: new Request('http://localhost/w/x/table/context', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ placeEntityId: placeId, sessionEntityId: null })
			}),
			params: { universe: universeSlug },
			locals: { user: { id: userId }, locale: 'en' }
		} as Parameters<typeof POST>[0];
	}

	it('gives every pin a warm field, not the raw PinnedNeighbor shape the graph query returns', async () => {
		const res = await POST(declareEvent());
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			pinned: Array<{
				entityId: string;
				name: string;
				warm?: { status: string; lastWarmedAt?: string | null };
			}>;
		};

		expect(body.pinned).toHaveLength(2);
		for (const pin of body.pinned) {
			// The exact read PinnedCards.svelte does (`pin.warm.status`) - `warm` missing
			// here is precisely the pre-fix "Cannot read properties of undefined" crash.
			expect(pin.warm).toBeDefined();
			expect(['warm', 'cold']).toContain(pin.warm?.status);
		}

		const warm = body.pinned.find((pin) => pin.entityId === warmNeighborId);
		const cold = body.pinned.find((pin) => pin.entityId === coldNeighborId);
		expect(warm?.warm).toMatchObject({ status: 'warm' });
		expect(cold?.warm).toMatchObject({ status: 'cold', lastWarmedAt: null });
	});
});
