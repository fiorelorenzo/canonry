/**
 * Gate for the whole /admin subtree (issues #113 and #86): every page view under here
 * calls requireAdmin before rendering. See src/lib/server/admin.ts for what the check
 * does and why a non-staff session (or none at all) is a 404 rather than a login
 * redirect that would otherwise announce the subtree's existence. Named actions on the
 * individual admin pages call the same function again - see that file's doc.
 */
import { requireAdmin } from '$lib/server/admin';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	requireAdmin(event);
};
