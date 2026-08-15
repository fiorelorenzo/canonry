/**
 * `/settings`: issue #143 (I6 = B) puts the Account pane first, not a bare index -
 * mirrors `routes/u/new/+page.server.ts`'s own load-only-redirect shape (no
 * `+page.svelte` needed, since this route never actually renders anything).
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(303, '/settings/account');
};
