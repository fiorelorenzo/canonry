/**
 * Issue #158: the public profile at `/u/<handle>`, and the one write that creates one.
 *
 * Two halves, and the split matters. `setUserHandle`/`clearUserHandle` are the only writers
 * of `user.handle`, so the reserved list and the format are checked in one place before
 * Postgres's own constraints get a chance to refuse with a message nobody can act on.
 * `publicProfileByHandle` is the read a stranger with no account triggers, so guardrail 6
 * governs every column it selects: it names a world because that world has something a
 * player may read, never because somebody owns it, and it returns nothing at all about the
 * account behind the profile beyond the two things #158 decided a profile shows, the display
 * name and the handle. Not the id, not the email, not when the account was created.
 */
import { and, count, desc, eq, isNotNull, max, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { validateHandle, type HandleRejection } from '../handles.js';
import { user } from '../schema/auth.js';
import { entity } from '../schema/entity.js';
import { revelation } from '../schema/players.js';
import { universe } from '../schema/universe.js';

/** `lower(handle)`, written once. Every comparison against a handle goes through this,
 * because the unique index is on `lower(handle)` and a query that compared the stored form
 * would both miss the index and answer differently from the constraint that guards it. */
function loweredHandle() {
	return sql`lower(${user.handle})`;
}

export type SetHandleFailure = HandleRejection | 'taken';

export type SetHandleResult = { ok: true; handle: string } | { ok: false; reason: SetHandleFailure };

function isUniqueViolation(err: unknown): boolean {
	const cause = err instanceof Error ? err.cause : err;
	if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
	return cause.code === '23505';
}

/**
 * Takes or changes an account's handle. Validation first, so `reserved` and `format` are
 * answers rather than a 23514 nobody can turn into a sentence; then the insert, where a
 * `taken` can only be found out by trying, because between a "is it free" select and an
 * update somebody else can have taken it. `user_handle_lower_key` is what actually decides,
 * and this maps its violation onto the same result shape the validation failures use, so the
 * caller has one thing to branch on.
 *
 * Changing a handle is the same call as taking one: #158's acceptance says changeable, and
 * there is no separate rename path to keep in step with this one. What a change costs is
 * real and is stated on the settings pane rather than engineered around: the old URL stops
 * resolving, and nothing holds a redirect, because a reservation on every handle a person
 * has ever used would quietly make the namespace unusable.
 */
export async function setUserHandle(
	db: Db,
	userId: string,
	rawHandle: string
): Promise<SetHandleResult> {
	const validation = validateHandle(rawHandle);
	if (!validation.ok) return { ok: false, reason: validation.reason };

	try {
		const rows = await db
			.update(user)
			.set({ handle: validation.handle, updatedAt: new Date() })
			.where(eq(user.id, userId))
			.returning({ handle: user.handle });
		const handle = rows[0]?.handle;
		if (!handle) return { ok: false, reason: 'empty' };
		return { ok: true, handle };
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'taken' };
		throw err;
	}
}

/** Gives the handle up, which takes the profile down with it: back to null is back to no
 * public page at all. The counterpart of an opt-in that would not be one if it could not be
 * undone, and the reason the privacy page can say a profile is something you choose. */
export async function clearUserHandle(db: Db, userId: string): Promise<void> {
	await db.update(user).set({ handle: null, updatedAt: new Date() }).where(eq(user.id, userId));
}

/** The handle the settings pane prints back, or null for an account that never took one. */
export async function handleForUser(db: Db, userId: string): Promise<string | null> {
	const rows = await db
		.select({ handle: user.handle })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0]?.handle ?? null;
}

export interface PublishedWorld {
	name: string;
	/** The world's own public URL is `/p/<slug>`, which is the only link a profile ever
	 * makes: never `/w/<slug>`, which is the GM's side of the same world. */
	slug: string;
	/** How many entries a stranger can read on that world's wiki right now. */
	readableEntries: number;
	/** When the most recent of those entries became readable. Already public, to the day, on
	 * the world's own diary page. */
	lastPublishedAt: Date;
}

export interface PublicProfile {
	name: string;
	handle: string;
	worlds: PublishedWorld[];
}

/**
 * Everything `/u/<handle>` may show, and nothing else. Undefined for a handle nobody holds,
 * which the route turns into a 404 - the same 404 a malformed or reserved handle gets, since
 * neither can ever be stored and there is nothing to tell apart.
 *
 * **Why a world is on this list.** One join, and it is the whole guardrail: a `revelation`
 * row of kind `entity`, confirmed, pointing at an entry that is neither `gm_only` nor a
 * session. That is the same predicate the players' wiki itself reads (`listPublicEntities`
 * calls an entry `full` on exactly this condition), so a world is listed here when, and only
 * when, a stranger opening `/p/<slug>` finds something to read. Ownership is the filter on
 * *whose* worlds, never the reason one appears: an owner with ten worlds and one published
 * has one row here.
 *
 * `count(distinct)` rather than `count`, because a world revealed across three sessions has
 * three revelation rows for the same entry and a raw count would advertise a number the wiki
 * does not have.
 *
 * The corner this deliberately leaves out: a world whose only confirmed revelation is a
 * session entry, with no entries revealed under it, is not listed. Its diary is reachable at
 * its own URL either way, and a profile row reading "no entries" would be a row saying
 * nothing. `publishWorld` always reveals a session alongside the entries it publishes, so
 * this is a shape a real world does not have.
 */
export async function publicProfileByHandle(
	db: Db,
	handle: string
): Promise<PublicProfile | undefined> {
	const [owner] = await db
		.select({ id: user.id, name: user.name, handle: user.handle })
		.from(user)
		.where(eq(loweredHandle(), handle.trim().toLowerCase()))
		.limit(1);
	if (!owner?.handle) return undefined;

	const worlds = await db
		.select({
			name: universe.name,
			slug: universe.slug,
			readableEntries: count(sql`distinct ${entity.id}`),
			lastPublishedAt: max(revelation.confirmedAt)
		})
		.from(universe)
		.innerJoin(
			revelation,
			and(
				eq(revelation.universeId, universe.id),
				eq(revelation.kind, 'entity'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.innerJoin(
			entity,
			and(
				eq(entity.id, revelation.entityId),
				ne(entity.visibility, 'gm_only'),
				ne(entity.type, 'session')
			)
		)
		.where(eq(universe.ownerUserId, owner.id))
		.groupBy(universe.id)
		.orderBy(desc(max(revelation.confirmedAt)));

	return {
		name: owner.name,
		handle: owner.handle,
		worlds: worlds.map((row) => ({
			name: row.name,
			slug: row.slug,
			readableEntries: row.readableEntries,
			// `listPublicEntities` has the same note: postgres.js only decodes timestamptz for a
			// plain column reference, so a `max(...)` aggregate arrives as wire text.
			lastPublishedAt: new Date(row.lastPublishedAt as unknown as string)
		}))
	};
}
