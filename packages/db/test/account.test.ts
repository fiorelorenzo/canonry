/** Issue #154: `accountDeletionImpact` is the number the account-deletion screen shows
 * before a GM can even request the confirmation mail - it has to match exactly what
 * `universe.owner_user_id`'s `ON DELETE CASCADE` (and the three tables that cascade off
 * `universe_id` in turn) would actually destroy. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountDeletionImpact, closeDb, type Db } from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { mediaAsset } from '../src/schema/media.js';
import { proposal } from '../src/schema/proposal.js';
import { revision } from '../src/schema/revision.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

describe('accountDeletionImpact (issue #154)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('is all zero for an account that owns no universe', async () => {
		const owner = await insertUser(db);
		expect(await accountDeletionImpact(db, owner.id)).toEqual({
			universes: 0,
			entities: 0,
			revisions: 0,
			proposals: 0,
			images: 0
		});
	});

	it('counts an empty universe as one universe and nothing else', async () => {
		const owner = await insertUser(db);
		await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		expect(await accountDeletionImpact(db, owner.id)).toEqual({
			universes: 1,
			entities: 0,
			revisions: 0,
			proposals: 0,
			images: 0
		});
	});

	it('sums entities, revisions, proposals and images across every universe the account owns, and leaves a stranger\u2019s universe out', async () => {
		const owner = await insertUser(db);
		const worldA = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const worldB = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const stranger = await insertUser(db);
		const strangerWorld = await insertHomebrewUniverse(db, { ownerUserId: stranger.id });

		const [entityA] = await db
			.insert(entity)
			.values({ universeId: worldA.id, type: 'character', name: 'Aldric', slug: unique('aldric') })
			.returning();
		const [entityB] = await db
			.insert(entity)
			.values({ universeId: worldB.id, type: 'place', name: 'Valdoria', slug: unique('valdoria') })
			.returning();
		if (!entityA || !entityB) throw new Error('fixture setup failed');

		await db.insert(entity).values({
			universeId: strangerWorld.id,
			type: 'faction',
			name: 'Not Yours',
			slug: unique('not-yours')
		});

		await db.insert(revision).values([
			{
				universeId: worldA.id,
				entityId: entityA.id,
				authorKind: 'human',
				name: entityA.name,
				aliases: [],
				body: 'v1'
			},
			{
				universeId: worldA.id,
				entityId: entityA.id,
				authorKind: 'human',
				name: entityA.name,
				aliases: [],
				body: 'v2'
			},
			{
				universeId: worldB.id,
				entityId: entityB.id,
				authorKind: 'human',
				name: entityB.name,
				aliases: [],
				body: 'v1'
			}
		]);

		await db.insert(proposal).values({
			universeId: worldA.id,
			trigger: 'save',
			kind: 'update',
			targetEntityId: entityA.id,
			patch: {}
		});

		await db.insert(mediaAsset).values([
			{
				universeId: worldA.id,
				entityId: entityA.id,
				kind: 'image',
				path: 'a.png',
				mimeType: 'image/png'
			},
			{
				universeId: worldB.id,
				entityId: entityB.id,
				kind: 'image',
				path: 'b.png',
				mimeType: 'image/png'
			}
		]);

		expect(await accountDeletionImpact(db, owner.id)).toEqual({
			universes: 2,
			entities: 2,
			revisions: 3,
			proposals: 1,
			images: 2
		});
		// The stranger's own universe and entity never leak into the owner's count.
		expect(await accountDeletionImpact(db, stranger.id)).toEqual({
			universes: 1,
			entities: 1,
			revisions: 0,
			proposals: 0,
			images: 0
		});
	});
});
