/**
 * Issue #158. Two things are being defended here and they are not the same thing.
 *
 * The first is `validateHandle`, which is a pure function and needs no database: it is what
 * turns a bad handle into a sentence somebody can act on.
 *
 * The second is that Postgres refuses the same inputs regardless of who is writing. That is
 * the part worth a database test, because the reason the reserved list ships inside a check
 * constraint rather than only in a form is precisely that a form is not the only writer: a
 * seed, a script, a future admin tool and a hand-typed `update` all have to lose too. So
 * every case below writes past `setUserHandle` straight into the table.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	clearUserHandle,
	closeDb,
	handleForUser,
	publicProfileByHandle,
	RESERVED_HANDLES,
	revealEntityLive,
	setUserHandle,
	validateHandle,
	type Db
} from '../src/index.js';
import { user } from '../src/schema/auth.js';
import { entity } from '../src/schema/entity.js';
import { universe } from '../src/schema/universe.js';
import { expectConstraintViolation, insertUser, testDb, unique } from './helpers.js';

/** Handles have to survive a `lower()` comparison, so a fixture handle carries no hyphen at
 * the ends and no uppercase unless the test is about uppercase. */
function handle(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

describe('validateHandle', () => {
	it('accepts what a handle is', () => {
		for (const good of ['lorenzo', 'ab', 'a1', 'valdoria-reach', 'gm-of-the-ashen-ledger', '404s']) {
			expect(validateHandle(good)).toEqual({ ok: true, handle: good });
		}
	});

	it('keeps the case the person typed', () => {
		expect(validateHandle('Lorenzo')).toEqual({ ok: true, handle: 'Lorenzo' });
	});

	it('trims, because a trailing space in a pasted handle is not a different handle', () => {
		expect(validateHandle('  lorenzo\n')).toEqual({ ok: true, handle: 'lorenzo' });
	});

	it('refuses every shape a URL segment cannot be', () => {
		expect(validateHandle('')).toEqual({ ok: false, reason: 'empty' });
		expect(validateHandle('   ')).toEqual({ ok: false, reason: 'empty' });
		expect(validateHandle('a')).toEqual({ ok: false, reason: 'too-short' });
		expect(validateHandle('a'.repeat(31))).toEqual({ ok: false, reason: 'too-long' });
		for (const bad of [
			'-lorenzo',
			'lorenzo-',
			'lore--nzo',
			'lore nzo',
			'lore.nzo',
			'lore_nzo',
			'lorenzo/w',
			'lorènzo',
			'ロレンツォ'
		]) {
			expect(validateHandle(bad)).toEqual({ ok: false, reason: 'format' });
		}
	});

	it('refuses every reserved word, in any case', () => {
		for (const reserved of RESERVED_HANDLES) {
			expect(validateHandle(reserved)).toEqual({ ok: false, reason: 'reserved' });
			expect(validateHandle(reserved.toUpperCase())).toEqual({ ok: false, reason: 'reserved' });
		}
	});

	it('still carries the twenty-two words issue #158 recorded', () => {
		// A list that quietly loses a word is the failure mode this constraint exists to
		// prevent, and it is not one a shape test would catch.
		expect([...RESERVED_HANDLES].sort()).toEqual(
			[
				'about',
				'admin',
				'api',
				'assets',
				'blog',
				'dev',
				'docs',
				'help',
				'login',
				'logout',
				'me',
				'new',
				'pricing',
				'privacy',
				'settings',
				'signin',
				'signup',
				'static',
				'support',
				'terms',
				'u',
				'w'
			].sort()
		);
	});
});

describe('user.handle in the database', () => {
	let db: Db;
	const createdUserIds: string[] = [];
	const createdUniverseSlugs: string[] = [];

	async function newUser(overrides: Partial<typeof user.$inferInsert> = {}) {
		const row = await insertUser(db, overrides);
		createdUserIds.push(row.id);
		return row;
	}

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		for (const slug of createdUniverseSlugs) {
			await db.delete(universe).where(eq(universe.slug, slug));
		}
		for (const id of createdUserIds) {
			await db.delete(user).where(eq(user.id, id));
		}
		await closeDb(db);
	});

	it('lets every account sit at null at once, because a handle is opt-in', async () => {
		const a = await newUser();
		const b = await newUser();
		expect(a.handle).toBeNull();
		expect(b.handle).toBeNull();
		expect(await handleForUser(db, a.id)).toBeNull();
	});

	it('refuses a second handle differing only in case', async () => {
		const taken = handle('case');
		await newUser({ handle: taken });
		const second = await newUser();
		await expectConstraintViolation(
			db.update(user).set({ handle: taken.toUpperCase() }).where(eq(user.id, second.id)),
			'user_handle_lower_key'
		);
	});

	it('refuses a reserved word written straight into the table', async () => {
		const row = await newUser();
		await expectConstraintViolation(
			db.update(user).set({ handle: 'Settings' }).where(eq(user.id, row.id)),
			'user_handle_not_reserved'
		);
	});

	it('refuses a malformed handle written straight into the table', async () => {
		const row = await newUser();
		for (const bad of ['-nope', 'no pe', 'n', 'a'.repeat(31)]) {
			await expectConstraintViolation(
				db.update(user).set({ handle: bad }).where(eq(user.id, row.id)),
				'user_handle_format'
			);
		}
	});

	it('setUserHandle answers taken rather than throwing', async () => {
		const wanted = handle('taken');
		await newUser({ handle: wanted });
		const other = await newUser();
		expect(await setUserHandle(db, other.id, wanted.toUpperCase())).toEqual({
			ok: false,
			reason: 'taken'
		});
	});

	it('setUserHandle changes a handle, and clearUserHandle takes the profile down', async () => {
		const row = await newUser();
		const first = handle('first');
		const second = handle('second');
		expect(await setUserHandle(db, row.id, first)).toEqual({ ok: true, handle: first });
		expect(await setUserHandle(db, row.id, second)).toEqual({ ok: true, handle: second });
		expect(await publicProfileByHandle(db, first)).toBeUndefined();
		expect((await publicProfileByHandle(db, second))?.handle).toBe(second);

		await clearUserHandle(db, row.id);
		expect(await handleForUser(db, row.id)).toBeNull();
		expect(await publicProfileByHandle(db, second)).toBeUndefined();
	});
});

describe('publicProfileByHandle', () => {
	let db: Db;
	let ownerId: string;
	let takenHandle: string;
	const slugs: string[] = [];

	beforeAll(async () => {
		db = testDb();
		takenHandle = handle('profile');
		const owner = await insertUser(db, { handle: takenHandle, name: 'The Owner' });
		ownerId = owner.id;

		// Two worlds, one published and one not, plus a world somebody else owns.
		const publishedSlug = unique('profile-published');
		const quietSlug = unique('profile-quiet');
		slugs.push(publishedSlug, quietSlug);
		const [published] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'The Published One',
				slug: publishedSlug,
				kind: 'homebrew'
			})
			.returning({ id: universe.id });
		await db.insert(universe).values({
			ownerUserId: ownerId,
			name: 'The Quiet One',
			slug: quietSlug,
			kind: 'homebrew'
		});
		if (!published) throw new Error('universe insert did not return a row');

		const [session, revealed] = await db
			.insert(entity)
			.values([
				{
					universeId: published.id,
					type: 'session' as const,
					name: 'Session 1',
					slug: unique('session'),
					body: 'The party met.'
				},
				{
					universeId: published.id,
					type: 'faction' as const,
					name: 'The Ashen Ledger',
					slug: unique('ledger'),
					body: 'A merchant bank.'
				}
			])
			.returning({ id: entity.id });
		if (!session || !revealed) throw new Error('entity insert did not return a row');

		await revealEntityLive(db, {
			universeId: published.id,
			entityId: session.id,
			sessionEntityId: session.id
		});
		await revealEntityLive(db, {
			universeId: published.id,
			entityId: revealed.id,
			sessionEntityId: session.id
		});
	});

	afterAll(async () => {
		for (const slug of slugs) await db.delete(universe).where(eq(universe.slug, slug));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	it('lists a world because it is published, never because it is owned', async () => {
		const profile = await publicProfileByHandle(db, takenHandle);
		expect(profile?.name).toBe('The Owner');
		expect(profile?.worlds.map((world) => world.name)).toEqual(['The Published One']);
	});

	it('counts entries a player can read, and a session is not one', async () => {
		const profile = await publicProfileByHandle(db, takenHandle);
		expect(profile?.worlds[0]?.readableEntries).toBe(1);
		expect(profile?.worlds[0]?.lastPublishedAt).toBeInstanceOf(Date);
	});

	it('resolves the handle whatever case it is asked for', async () => {
		expect((await publicProfileByHandle(db, takenHandle.toUpperCase()))?.handle).toBe(takenHandle);
		expect((await publicProfileByHandle(db, ` ${takenHandle} `))?.handle).toBe(takenHandle);
	});

	it('is undefined for a handle nobody holds', async () => {
		expect(await publicProfileByHandle(db, handle('nobody'))).toBeUndefined();
	});
});
