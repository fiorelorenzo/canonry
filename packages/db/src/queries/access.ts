// Ownership and membership (issue #86): universe.owner_user_id and universe_member are
// real once accounts exist, so "every universe on this server" becomes "yours, or one
// you were added to". Read-only - nothing here writes a universe_member row, that is a
// future invite flow's job, not auth's.
import { and, count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { UniverseMemberRole } from '../schema/enums.js';
import { universe, universeMember } from '../schema/universe.js';

export interface UniverseAccess {
	universe: typeof universe.$inferSelect;
	/** 'owner' for the recorded owner_user_id even without an explicit universe_member
	 * row - ownership is never weaker than membership. */
	role: UniverseMemberRole;
}

/** One universe by slug, checked against `userId`'s access - the owner, or a row in
 * universe_member. `universe.slug` is globally unique (decision J1, issue #153: a
 * world's URL carries no owner), so one row is the whole answer, not the whole answer
 * for this owner - there is no other owner it could ambiguously mean. Returns null
 * rather than throwing so a caller can 404 without leaking whether the slug exists at
 * all (matches the pattern requireAdmin already uses for the same reason). */
export async function universeAccessBySlug(
	db: Db,
	slug: string,
	userId: string
): Promise<UniverseAccess | null> {
	const [row] = await db.select().from(universe).where(eq(universe.slug, slug)).limit(1);
	if (!row) return null;
	if (row.ownerUserId === userId) return { universe: row, role: 'owner' };

	const [membership] = await db
		.select({ role: universeMember.role })
		.from(universeMember)
		.where(and(eq(universeMember.universeId, row.id), eq(universeMember.userId, userId)))
		.limit(1);
	if (!membership) return null;
	return { universe: row, role: membership.role };
}

/** Every universe `userId` may see: owned, or a row in universe_member. Powers the root
 * universe list and the sidebar switcher, replacing "every universe on this server"
 * (issue #86). Ordered by name, same as the pre-auth listing it replaces. */
export async function universesForUser(
	db: Db,
	userId: string
): Promise<Array<typeof universe.$inferSelect>> {
	const owned = await db.select().from(universe).where(eq(universe.ownerUserId, userId));
	const memberOf = await db
		.select({ universe })
		.from(universeMember)
		.innerJoin(universe, eq(universe.id, universeMember.universeId))
		.where(eq(universeMember.userId, userId));

	const byId = new Map(owned.map((row) => [row.id, row]));
	for (const { universe: row } of memberOf) byId.set(row.id, row);
	return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Decision C3 amendment (docs/design/DECISIONS.md "Round nine"): the per-universe
 * propagation cap, read by itself. `runPropagationEngine`
 * (apps/web/src/lib/server/jobs/canon-save.ts) only carries a durable job row's
 * `universeId` through the queue, not the whole universe row, and a save's plan needs
 * nothing else about the universe - selecting one column avoids pulling the rest of a
 * row this call has no use for. Null is returned exactly as stored: it means the GM
 * turned the limit off, and `planPropagation` is what decides what that means, not
 * this read. */
export async function propagationCapForUniverse(
	db: Db,
	universeId: string
): Promise<number | null> {
	const [row] = await db
		.select({ propagationCap: universe.propagationCap })
		.from(universe)
		.where(eq(universe.id, universeId))
		.limit(1);
	return row?.propagationCap ?? null;
}

/** Issue #141: the shell's account-level switcher needs an entry count per universe
 * on every route, not only inside one, and a per-universe `SELECT count(*)` in that
 * root layout would turn into an N+1 on every page in the app. One grouped query for
 * the whole account instead - a universe with no entities yet is simply absent from
 * the result, so callers default it to zero rather than reading `undefined` as a bug. */
export async function entityCountsByUniverseIds(
	db: Db,
	universeIds: readonly string[]
): Promise<Map<string, number>> {
	if (universeIds.length === 0) return new Map();
	const rows = await db
		.select({ universeId: entity.universeId, total: count() })
		.from(entity)
		.where(inArray(entity.universeId, universeIds as string[]))
		.groupBy(entity.universeId);
	return new Map(rows.map((row) => [row.universeId, row.total]));
}
