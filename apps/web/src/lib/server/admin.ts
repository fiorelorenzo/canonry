/**
 * Gate for the whole /admin subtree (issue #113, replaced here per issue #86). Real
 * auth exists now, so the shared ADMIN_TOKEN secret is gone: a request reaches the
 * subtree only with a real signed-in session (`locals.user`, populated in
 * `hooks.server.ts`) whose email is on the STAFF_EMAILS allowlist. A missing or
 * non-staff session renders as a plain 404, never a 401 or a login redirect, so the
 * subtree does not advertise that it exists - the same reasoning the shared-secret
 * gate used, just checked against a real identity instead of a bearer token.
 *
 * `admin/+layout.server.ts` calls this from its `load` for every page view. That
 * covers navigation, but SvelteKit runs a POST form action before any layout load
 * (the action belongs to the page's own +page.server.ts, not the layout), so a page
 * under this subtree that defines actions must call requireAdmin again at the top
 * of each one. The check itself still lives in exactly this one place either way.
 */
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

interface AdminRequest {
	locals: {
		user: { id: string; email: string } | null;
	};
}

/** STAFF_EMAILS is a comma-separated allowlist rather than a column on `user`: Better
 * Auth owns that table's exact shape (packages/db/src/schema/auth.ts's own doc
 * comment - "nothing here is a design choice"), and a platform-wide staff role is a
 * deployment fact, not a per-account field a sign-up flow would ever set. Empty or
 * unset means no staff at all, matching ADMIN_TOKEN's old "unset is unavailable, not
 * open" default. */
function staffAllowlist(): string[] {
	return (env.STAFF_EMAILS ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0);
}

/**
 * Throws a 404 unless the request carries a session for a user on STAFF_EMAILS. Never
 * a 401 or a redirect to sign-in - existence of the subtree is not for a non-staff
 * visitor to learn, signed in or not.
 */
export function requireAdmin(event: AdminRequest): void {
	const user = event.locals.user;
	if (!user) error(404, 'Not Found');

	const staff = staffAllowlist();
	if (!staff.includes(user.email.toLowerCase())) error(404, 'Not Found');
}
