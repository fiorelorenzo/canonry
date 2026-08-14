import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, universeAccessBySlug, universesForUser, type Db } from '../src/index.js';
import { universeMember } from '../src/schema/universe.js';
import { insertHomebrewUniverse, insertUser, testDb } from './helpers.js';

describe('universeAccessBySlug and universesForUser', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('the owner sees their own universe', async () => {
		const owner = await insertUser(db);
		const world = await insertHomebrewUniverse(db, { ownerUserId: owner.id });

		const access = await universeAccessBySlug(db, world.slug, owner.id);
		expect(access?.role).toBe('owner');
		expect(access?.universe.id).toBe(world.id);

		const list = await universesForUser(db, owner.id);
		expect(list.map((row) => row.id)).toContain(world.id);
	});

	it("a second account cannot see the first account's universe (issue #86 acceptance)", async () => {
		const owner = await insertUser(db);
		const world = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const stranger = await insertUser(db);

		expect(await universeAccessBySlug(db, world.slug, stranger.id)).toBeNull();

		const list = await universesForUser(db, stranger.id);
		expect(list.map((row) => row.id)).not.toContain(world.id);
	});

	it('an explicit universe_member row grants access without being the owner', async () => {
		const owner = await insertUser(db);
		const world = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const editor = await insertUser(db);
		await db
			.insert(universeMember)
			.values({ universeId: world.id, userId: editor.id, role: 'editor' });

		const access = await universeAccessBySlug(db, world.slug, editor.id);
		expect(access?.role).toBe('editor');

		const list = await universesForUser(db, editor.id);
		expect(list.map((row) => row.id)).toContain(world.id);
	});

	it('returns null for an unknown slug rather than throwing - never leaks existence', async () => {
		const someone = await insertUser(db);
		expect(await universeAccessBySlug(db, 'no-such-universe-slug', someone.id)).toBeNull();
	});
});
