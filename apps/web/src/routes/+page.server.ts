/**
 * `/`: every universe that exists, per the contract this route owns. There is no
 * auth yet (#86), so this is genuinely every universe on the server, not "yours" -
 * said plainly on the page itself rather than left for a reader to assume.
 */
import { db } from '$lib/server/db';
import type { UniverseSummary } from '$lib/components/shell/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const database = db();

	const rows = await database.query.universe.findMany({
		orderBy: (universe, { asc }) => asc(universe.name)
	});
	const nameById = new Map(rows.map((row) => [row.id, row.name]));

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
				baseUniverseName: row.baseUniverseId ? (nameById.get(row.baseUniverseId) ?? null) : null,
				entityCount: entities.length
			};
		})
	);

	return { universes };
};
