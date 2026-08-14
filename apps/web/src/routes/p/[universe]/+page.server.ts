import { db } from '$lib/server/db';
import { loadPublicIndex } from '$lib/server/players';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { universe } = await parent();
	const entities = await loadPublicIndex(db(), universe.id);
	return { entities };
};
