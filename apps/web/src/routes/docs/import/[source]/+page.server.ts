/**
 * One route serves all seven import guides (#110): the chrome is identical, only
 * the content in `importGuides.ts` differs per source, so this looks the content up
 * by slug instead of shipping seven near-identical `+page.svelte` files.
 */
import { error } from '@sveltejs/kit';
import { IMPORT_GUIDES } from '$lib/components/docs/importGuides';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const guide = IMPORT_GUIDES.find((candidate) => candidate.slug === params.source);
	if (!guide) error(404, `No import guide for "${params.source}"`);
	return { guide };
};
