/**
 * Loads everything the fixed sidebar (A2 = A) needs for every route nested under a
 * universe, Entry's entry and editor routes included: the current universe, every
 * universe for the switcher (with entity counts and, for a derived universe, what it
 * reads from per SPEC.md 4.1), and a short Recent list.
 */
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { UniverseSummary } from '$lib/components/shell/types';
import type { LayoutServerLoad } from './$types';

const SIDEBAR_RECENT_LIMIT = 5;

export const load: LayoutServerLoad = async ({ params }) => {
	const database = db();

	const currentRow = await database.query.universe.findFirst({
		where: (universe, { eq }) => eq(universe.slug, params.universe)
	});
	if (!currentRow) error(404, `no universe called "${params.universe}"`);

	const allRows = await database.query.universe.findMany({
		orderBy: (universe, { asc }) => asc(universe.name)
	});
	const nameById = new Map(allRows.map((row) => [row.id, row.name]));

	const universes: UniverseSummary[] = await Promise.all(
		allRows.map(async (row) => {
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

	const current = universes.find((universe) => universe.id === currentRow.id);
	if (!current) error(404, `no universe called "${params.universe}"`);

	const recent = await database.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, currentRow.id),
		orderBy: (entity, { desc }) => desc(entity.updatedAt),
		limit: SIDEBAR_RECENT_LIMIT,
		columns: { id: true, name: true, slug: true, type: true }
	});

	return {
		universeSlug: current.slug,
		current,
		universes,
		recent,
		navCounts: { entries: current.entityCount }
	};
};
