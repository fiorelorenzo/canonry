/**
 * Issue #142, I4 = B ("one creation surface", docs/ux/DECISIONS.md): this used to be a
 * second, rival door to universe creation - its own name field and Create button, doing
 * exactly what /onboarding's new "start empty" card now does. It redirects into /onboarding
 * rather than staying a second route; nothing in the codebase links here (checked with
 * grep before this change), so the redirect alone is the whole cutover.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(303, '/onboarding');
};
