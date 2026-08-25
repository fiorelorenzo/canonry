/**
 * Issue #795 (DECISIONS.md "Round twenty-one", amends U1): this leaf moved to
 * `/w/[universe]/relations` - a first-class page now, not a settings sub-page - so this
 * is only a permanent redirect for whoever still has the old bookmark or the review
 * queue's own shipped-refusal link (`ProposalDiffCard.svelte`, updated to point at the
 * new path directly), same shape as `ask/kept/+page.server.ts`'s own load-only
 * redirect: no `+page.svelte` needed, since this route never actually renders anything.
 * The full query string rides along so a hand-typed `?fork=<id>&addFrom=...` link still
 * lands on the right dialog rather than a bare list.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	redirect(308, `/w/${params.universe}/relations${url.search}`);
};
