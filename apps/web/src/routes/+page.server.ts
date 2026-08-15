/**
 * `/`: your universes - owned, or one you were added to (issue #86 replaces "every
 * universe on this server" with real ownership and membership).
 *
 * Issue #141: the list itself now comes from `await parent()` - the root layout
 * already ran `universesForUser` plus one grouped entity-count query for the
 * switcher, and every route needs that same list now, not only this one, so this
 * loader reuses it rather than querying twice per request.
 *
 * Issue #140: zero universes used to render a dead sentence pointing nowhere useful.
 * /onboarding is D7's decided import-first path and was linked from nothing, so a
 * fresh account now lands there instead. One universe skips the picker and goes
 * straight in. /onboarding's own load only checks locals.user, never universe count,
 * so it never redirects back here - an account that deliberately drops back to zero
 * universes lands on /onboarding again on its next visit to /, not in a loop.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { universes } = await parent();
	if (!locals.user) return { universes };

	if (universes.length === 0) redirect(303, '/onboarding');
	if (universes.length === 1) redirect(303, `/w/${universes[0].slug}`);

	return { universes };
};
