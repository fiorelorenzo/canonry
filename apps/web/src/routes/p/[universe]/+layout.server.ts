/**
 * Resolves the universe once for every page nested under `/p/[universe]` - the index and
 * the entity detail page both read `parent()` rather than re-querying the universe table.
 * `loadPublicUniverse` only ever selects id/name/slug (see `universeForExport`, which this
 * reuses): nothing about ownership, AI settings or billing ever travels into this surface.
 */
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadPublicUniverse } from '$lib/server/players';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params }) => {
	const universe = await loadPublicUniverse(db(), params.universe);
	if (!universe) error(404, `No universe called "${params.universe}"`);
	return { universe };
};
