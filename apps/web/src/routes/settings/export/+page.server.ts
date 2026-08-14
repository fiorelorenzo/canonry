/**
 * `/settings/export`: decision F4 = A, the flat zip's only entry point, deliberately not
 * linked from anywhere else in the app. Issue #86: scoped to the signed-in account's
 * own universes - owned, or one they were added to - the same as everywhere else
 * universesForUser replaced "every universe on this server".
 */
import { universesForUser } from '@canonry/db';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { universes: [] };

	const rows = await universesForUser(db(), locals.user.id);
	return {
		universes: rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }))
	};
};
