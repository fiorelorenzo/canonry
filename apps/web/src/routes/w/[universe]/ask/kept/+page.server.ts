/**
 * Issue #531, W3 = B (DECISIONS.md "Round eighteen"): this used to be a second list of
 * the same data `/w/[universe]/ask` now renders directly, so it stops being a page - a
 * redirect, same shape as `routes/settings/+page.server.ts`'s own load-only-redirect (no
 * `+page.svelte` needed, since this route never actually renders anything). The full
 * query string rides along so an old `/ask/kept?confirm=<id>` link still lands on the
 * right delete-confirm state rather than a bare list.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	redirect(308, `/w/${params.universe}/ask${url.search}`);
};
