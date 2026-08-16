/**
 * #83's detail page: a genuinely separate render from the GM's `/w/[universe]/e/[slug]`,
 * built entirely from `loadPublicEntity`'s already-filtered shape. An entity that does not
 * exist, or is `gm_only`, 404s with the same message either way - neither response tells a
 * player which of the two happened (guardrail 6, defense in depth: even the error text
 * carries no signal beyond the slug the requester already typed).
 */
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadPublicEntity } from '$lib/server/players';
import type { PageServerLoad } from './$types';

// L1 (#198): the locale comes from `parent()` rather than from `locals`, even though both
// hold the same value. `leak.test.ts` calls this `load` with a cast event providing exactly
// `params` and `parent`, deliberately, so that a route which starts reading more of the event
// gets noticed rather than silently permitted, and it caught this. Reading the locale from
// the parent data this loader already awaits keeps that contract, and it is the better answer
// anyway: the wiki's language is decided once for the whole render, in the root layout, not
// re-derived per route.
export const load: PageServerLoad = async ({ params, parent }) => {
	const { universe, locale } = await parent();
	const result = await loadPublicEntity(db(), universe.id, params.slug, locale);
	if (!result) error(404, `No entry named "${params.slug}"`);
	return result;
};
