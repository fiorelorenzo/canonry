/**
 * Issue #530 (round eighteen, GM half): the entry page's own "learned in" line -
 * `latestEntityRevelation`'s answer (`packages/db/src/queries/players.ts`), threaded
 * through the real `load` of this route exactly the way `cover-gate.test.ts` proves the
 * cover gate. Two entities, one with a confirmed 'entity' revelation and one without, so
 * this is a proof about the loader's own output rather than the query in isolation.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, type Db } from '@canonry/db';
import { entity, revelation, universe, universeMember, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load as loadEntry } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reason `cover-gate.test.ts` does this: the route's own `$lib/server/db.ts`
// singleton reads `$env/dynamic/private` with no fallback, and it has to be set before
// the first `load` call rather than inside one.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('the entry loader carries when this entity was revealed (issue #530)', () => {
	let db: Db;
	let ownerId: string;
	let universeSlug: string;
	let revealedSlug: string;
	let unrevealedSlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('revealed-in-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'Revealed In Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Revealed In Universe',
				slug: unique('revealed-in-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeSlug = uni.slug;

		await db.insert(universeMember).values({ universeId: uni.id, userId: ownerId, role: 'owner' });

		const [session, revealedEntity, unrevealedEntity] = await db
			.insert(entity)
			.values([
				{
					universeId: uni.id,
					type: 'session',
					name: 'The Reveal Session',
					slug: unique('session'),
					body: 'The night this came up.'
				},
				{
					universeId: uni.id,
					type: 'character',
					name: 'Known To The Party',
					slug: unique('revealed'),
					body: 'This one has come up at the table.'
				},
				{
					universeId: uni.id,
					type: 'character',
					name: 'Still A Secret',
					slug: unique('unrevealed'),
					body: 'Nothing has come up about this one yet.'
				}
			])
			.returning({ id: entity.id, slug: entity.slug });
		if (!session || !revealedEntity || !unrevealedEntity) {
			throw new Error('entity insert did not return three rows');
		}
		revealedSlug = revealedEntity.slug;
		unrevealedSlug = unrevealedEntity.slug;

		await db.insert(revelation).values({
			universeId: uni.id,
			kind: 'entity',
			entityId: revealedEntity.id,
			sessionEntityId: session.id,
			confirmedAt: new Date('2026-08-21T19:15:00Z')
		});
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function loadAs(slug: string) {
		return (await loadEntry({
			params: { universe: universeSlug, slug },
			locals: { user: { id: ownerId }, locale: 'en' }
		} as Parameters<typeof loadEntry>[0])) as {
			entity: { revealedIn: { sessionName: string | null; confirmedAt: string | Date } | null };
		};
	}

	it('carries the session and the moment for an entity the table has met', async () => {
		const data = await loadAs(revealedSlug);
		expect(data.entity.revealedIn).not.toBeNull();
		expect(data.entity.revealedIn?.sessionName).toBe('The Reveal Session');
		expect(new Date(data.entity.revealedIn!.confirmedAt).toISOString()).toBe(
			'2026-08-21T19:15:00.000Z'
		);
	});

	it('carries null for an entity nothing has revealed', async () => {
		const data = await loadAs(unrevealedSlug);
		expect(data.entity.revealedIn).toBeNull();
	});
});
