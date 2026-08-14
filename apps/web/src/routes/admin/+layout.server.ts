/**
 * Gate for the whole /admin subtree (issue #113): every page view under here calls
 * requireAdmin before rendering. See src/lib/server/admin.ts for what the check
 * does and why a missing or wrong secret is a 404 rather than a login redirect
 * that would otherwise announce the subtree's existence. Named actions on the
 * individual admin pages call the same function again - see that file's doc.
 */
import { requireAdmin } from '$lib/server/admin';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	requireAdmin(event);
};
