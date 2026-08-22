/**
 * #530, decision "W2 = A the campaign diary" (round eighteen): the wiki's own index is
 * the sessions the party has met, newest first, each carrying its own prose and what was
 * learned that night. `loadPlayerDiary` is the one seam - see its own doc comment in
 * `$lib/server/players` - so #85's leak test calls exactly this load, not a re-derivation.
 */
import { db } from '$lib/server/db';
import { loadPlayerDiary } from '$lib/server/players';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { universe, locale } = await parent();
	return loadPlayerDiary(db(), universe.id, universe.slug, locale);
};
