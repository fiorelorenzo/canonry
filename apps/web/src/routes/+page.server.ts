/**
 * `/`: your universes - owned, or one you were added to (issue #86 replaces "every
 * universe on this server" with real ownership and membership, via
 * @canonry/db's universesForUser). An unauthenticated visitor sees none and a prompt
 * to sign in on the page itself, rather than a list this route cannot attribute to
 * anyone.
 */
import { universesForUser } from '@canonry/db';
import { db } from '$lib/server/db';
import type { UniverseSummary } from '$lib/components/shell/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { universes: [] as UniverseSummary[] };

	const database = db();
	const rows = await universesForUser(database, locals.user.id);

	// A derived universe may point at a pre-indexed base universe nobody here owns
	// (SPEC.md §7: "famous universes ... offered as a starting layer, indexed from
	// their wikis"). Its name is part of the shared catalogue, not private content,
	// so it is looked up on its own rather than filtered through the ownership check
	// universesForUser already applied above.
	const baseIds = rows.map((row) => row.baseUniverseId).filter((id): id is string => id !== null);
	const baseNameById = new Map<string, string>();
	if (baseIds.length > 0) {
		const bases = await database.query.universe.findMany({
			where: (universe, { inArray }) => inArray(universe.id, baseIds),
			columns: { id: true, name: true }
		});
		for (const base of bases) baseNameById.set(base.id, base.name);
	}

	const universes: UniverseSummary[] = await Promise.all(
		rows.map(async (row) => {
			const entities = await database.query.entity.findMany({
				where: (entity, { eq }) => eq(entity.universeId, row.id),
				columns: { id: true }
			});
			return {
				id: row.id,
				name: row.name,
				slug: row.slug,
				kind: row.kind,
				baseUniverseName: row.baseUniverseId
					? (baseNameById.get(row.baseUniverseId) ?? null)
					: null,
				entityCount: entities.length
			};
		})
	);

	return { universes };
};
