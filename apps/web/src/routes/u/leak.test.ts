/**
 * Issue #158, guardrail 6: nothing unreviewed is ever published to players. A profile at
 * `/u/<handle>` is read by a stranger with no account, so it is the same kind of surface
 * `/p/**` is and it gets the same kind of test, in the same shape as `../p/leak.test.ts`:
 * a fixture built to contain exactly what a profile must never surface, and assertions
 * against `JSON.stringify` of the object the real `load` returns rather than against
 * rendered HTML, because a leak sitting unused in `PageData` is still a leak.
 *
 * What this fixture puts in front of the route, one row per way this page could go wrong:
 *
 * - a second universe the same person owns with **nothing revealed at all**, whose name
 *   and slug must appear nowhere. This is the whole issue: a world reaches a profile
 *   because its owner published it, never because they own it.
 * - a third universe owned by **somebody else**, so an owner filter that is missing or
 *   wrong shows up as a failure rather than as a coincidence.
 * - inside the published world: a `gm_only` entry (with a revelation row on it anyway,
 *   the same simulated bug `../p/leak.test.ts` carries), an entry nobody has revealed, a
 *   `:::secret` fence and a `:::gmnote` fence in the published entry's own body.
 * - the owner's **email address**, which guardrail 5 is about rather than guardrail 6: a
 *   profile puts a person next to a public page, and the account's address is the one
 *   fact about that person this product holds and must not print.
 *
 * The positive controls matter as much: the published world's name and slug have to be in
 * the payload, and the count the page prints has to be the number of entries a stranger
 * can actually read, or the test would pass just as well against a route that returns
 * nothing.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, revealEntityLive, type Db } from '@canonry/db';
import { entity, universe, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load as loadProfile } from './[handle]/+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reasoning as `../p/leak.test.ts`: the route's `load` reaches `$lib/server/db`'s
// singleton, which reads `env.DATABASE_URL` with no fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const UNPUBLISHED_WORLD_NAME = 'The World Nobody Has Published';
const OTHER_OWNER_WORLD_NAME = 'Somebody Else Entirely';
const GM_ONLY_NAME = 'The Umbral Concord';
const GM_ONLY_BODY = 'GM-only body nobody but the table owner should ever read.';
const UNDISCOVERED_NAME = 'The Quiet Cabal';
const SECRET_TEXT = 'Aldric Vane, the dismissed captain, is now on the Ledger payroll in secret.';
const GMNOTE_TEXT = 'GM only: play this reveal as her fault circling back.';

describe('public profile: leak test (#158)', () => {
	let db: Db;
	let ownerId: string;
	let ownerEmail: string;
	let otherOwnerId: string;
	let handle: string;
	let publishedSlug: string;
	let unpublishedSlug: string;
	let otherOwnerSlug: string;
	let handleWithNothingPublished: string;
	let bareHandleUserId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		ownerId = unique('profile-leak-owner');
		ownerEmail = `${ownerId}@example.test`;
		handle = unique('handle').replace(/-/g, '');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerId, name: 'Profile Leak Owner', email: ownerEmail, handle })
			.returning();
		if (!owner) throw new Error('owner insert did not return a row');

		otherOwnerId = unique('profile-leak-other');
		const [other] = await db
			.insert(user)
			.values({
				id: otherOwnerId,
				name: 'Another Owner',
				email: `${otherOwnerId}@example.test`
			})
			.returning();
		if (!other) throw new Error('other owner insert did not return a row');

		// A third account that has taken a handle and published nothing: the empty state,
		// which at launch is what most profiles are.
		bareHandleUserId = unique('profile-leak-bare');
		handleWithNothingPublished = unique('bare').replace(/-/g, '');
		await db.insert(user).values({
			id: bareHandleUserId,
			name: 'Nothing Published Yet',
			email: `${bareHandleUserId}@example.test`,
			handle: handleWithNothingPublished
		});

		publishedSlug = unique('profile-leak-published');
		unpublishedSlug = unique('profile-leak-unpublished');
		otherOwnerSlug = unique('profile-leak-other-owner');
		const [published, unpublished, otherWorld] = await db
			.insert(universe)
			.values([
				{
					ownerUserId: ownerId,
					name: 'The Published World',
					slug: publishedSlug,
					kind: 'homebrew' as const
				},
				{
					ownerUserId: ownerId,
					name: UNPUBLISHED_WORLD_NAME,
					slug: unpublishedSlug,
					kind: 'homebrew' as const
				},
				{
					ownerUserId: otherOwnerId,
					name: OTHER_OWNER_WORLD_NAME,
					slug: otherOwnerSlug,
					kind: 'homebrew' as const
				}
			])
			.returning({ id: universe.id });
		if (!published || !unpublished || !otherWorld)
			throw new Error('fixture universe insert failed');

		const body = [
			'A merchant bank that lends at knife point.',
			'',
			':::secret',
			SECRET_TEXT,
			':::',
			'',
			':::gmnote',
			GMNOTE_TEXT,
			':::'
		].join('\n');

		const [session, revealed, gmOnly, undiscovered] = await db
			.insert(entity)
			.values([
				{
					universeId: published.id,
					type: 'session' as const,
					name: 'Session 1',
					slug: unique('session'),
					body: 'The party gathered at the harbour.'
				},
				{
					universeId: published.id,
					type: 'faction' as const,
					name: 'The Ashen Ledger',
					slug: unique('ledger'),
					body
				},
				{
					universeId: published.id,
					type: 'faction' as const,
					name: GM_ONLY_NAME,
					slug: unique('umbral-concord'),
					visibility: 'gm_only' as const,
					body: GM_ONLY_BODY
				},
				{
					universeId: published.id,
					type: 'faction' as const,
					name: UNDISCOVERED_NAME,
					slug: unique('quiet-cabal'),
					body: 'Nobody has found this yet.'
				}
			])
			.returning({ id: entity.id });
		if (!session || !revealed || !gmOnly || !undiscovered)
			throw new Error('fixture entity insert failed');

		// The unpublished world gets an entry too, so "no revelation" is the only reason it
		// stays off the profile - not "no content".
		await db.insert(entity).values({
			universeId: unpublished.id,
			type: 'faction' as const,
			name: 'A Faction In The Unpublished World',
			slug: unique('unpublished-faction'),
			body: 'Written, never published.'
		});

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
		// Defense in depth, exactly as `../p/leak.test.ts` does it: a revelation row on a
		// `gm_only` entry, simulating the bug the schema comment says can never be allowed
		// to matter. It must not raise the count and must not name the entry.
		await revealEntityLive(db, {
			universeId: published.id,
			entityId: gmOnly.id,
			sessionEntityId: session.id
		});
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.slug, publishedSlug));
		await db.delete(universe).where(eq(universe.slug, unpublishedSlug));
		await db.delete(universe).where(eq(universe.slug, otherOwnerSlug));
		await db.delete(user).where(eq(user.id, ownerId));
		await db.delete(user).where(eq(user.id, otherOwnerId));
		await db.delete(user).where(eq(user.id, bareHandleUserId));
		await closeDb(db);
	});

	async function loadFor(handleParam: string): Promise<unknown> {
		return loadProfile({ params: { handle: handleParam } } as Parameters<typeof loadProfile>[0]);
	}

	it('lists the published world and nothing else the person owns', async () => {
		const result = (await loadFor(handle)) as {
			profile: { name: string; handle: string; worlds: { name: string; slug: string }[] };
		};
		const payload = JSON.stringify(result);

		// Positive control first: a test that only asserts absences passes against a route
		// that returns nothing at all.
		expect(result.profile.worlds).toHaveLength(1);
		expect(result.profile.worlds[0]?.slug).toBe(publishedSlug);
		expect(result.profile.worlds[0]?.name).toBe('The Published World');
		expect(payload).toContain(publishedSlug);

		for (const needle of [
			UNPUBLISHED_WORLD_NAME,
			unpublishedSlug,
			OTHER_OWNER_WORLD_NAME,
			otherOwnerSlug,
			GM_ONLY_NAME,
			GM_ONLY_BODY,
			UNDISCOVERED_NAME,
			SECRET_TEXT,
			GMNOTE_TEXT
		]) {
			expect(payload).not.toContain(needle);
		}
	});

	it('never carries the account behind the profile: no email, no user id', async () => {
		const result = await loadFor(handle);
		const payload = JSON.stringify(result);
		// Guardrail 5. The display name and the handle are the two things a profile is
		// allowed to say about a person; the address the account was created with is not
		// one of them, and neither is the id every other table joins on.
		expect(payload).not.toContain(ownerEmail);
		expect(payload).not.toContain(ownerId);
	});

	it('counts only the entries a stranger can read', async () => {
		const result = (await loadFor(handle)) as {
			profile: { worlds: { readableEntries: number }[] };
		};
		// Four entries exist in the published world. One is the session (the diary, not an
		// entry), one is `gm_only` with a revelation row on it, one was never revealed.
		// One is readable.
		expect(result.profile.worlds[0]?.readableEntries).toBe(1);
	});

	it('serves a profile with no worlds rather than hiding the person', async () => {
		const result = (await loadFor(handleWithNothingPublished)) as {
			profile: { name: string; worlds: unknown[] };
		};
		expect(result.profile.name).toBe('Nothing Published Yet');
		expect(result.profile.worlds).toHaveLength(0);
	});

	it('resolves a handle case-insensitively, and prints the form its owner typed', async () => {
		const result = (await loadFor(handle.toUpperCase())) as { profile: { handle: string } };
		expect(result.profile.handle).toBe(handle);
	});

	it('404s for a handle nobody has taken', async () => {
		await expect(loadFor(unique('nobody'))).rejects.toSatisfy(
			(err: unknown) => isHttpError(err) && err.status === 404
		);
	});

	it('404s for an account that has never chosen a handle', async () => {
		// The other owner exists and owns a world; without a handle there is no profile and
		// nothing about them is reachable, which is decision "chosen later, opt-in".
		await expect(loadFor(otherOwnerId)).rejects.toSatisfy(
			(err: unknown) => isHttpError(err) && err.status === 404
		);
	});

	it('404s for a reserved word', async () => {
		for (const reserved of ['new', 'settings', 'me', 'admin']) {
			await expect(loadFor(reserved)).rejects.toSatisfy(
				(err: unknown) => isHttpError(err) && err.status === 404
			);
		}
	});
});
