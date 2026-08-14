/**
 * #83's detail page: a genuinely separate render from the GM's `/u/[universe]/e/[slug]`,
 * built entirely from `loadPublicEntity`'s already-filtered shape. An entity that does not
 * exist, or is `gm_only`, 404s with the same message either way - neither response tells a
 * player which of the two happened (guardrail 6, defense in depth: even the error text
 * carries no signal beyond the slug the requester already typed).
 */
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadPublicEntity } from '$lib/server/players';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { universe } = await parent();
	const result = await loadPublicEntity(db(), universe.id, params.slug);
	if (!result) error(404, `No entry named "${params.slug}"`);
	return result;
};
