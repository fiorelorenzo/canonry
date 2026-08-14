/**
 * `/settings/export`: decision F4 = A, the flat zip's only entry point, deliberately not
 * linked from anywhere else in the app. Every universe on the server gets its own
 * download link, same "no auth yet" caveat as the root universe list (#86).
 */
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db().query.universe.findMany({
		orderBy: (universe, { asc }) => asc(universe.name)
	});

	return {
		universes: rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }))
	};
};
