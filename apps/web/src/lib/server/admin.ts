/**
 * Gate for the whole /admin subtree (issue #113). There is no real auth yet - #86
 * will replace this with a staff role - so until then every admin route sits behind
 * one shared secret read from ADMIN_TOKEN. A missing or wrong secret renders as a
 * plain 404, never a 401 or a login screen, so the subtree does not advertise that
 * it exists. When ADMIN_TOKEN itself is unset the subtree is unavailable rather
 * than open: there is deliberately no "no secret configured, let everyone in" path.
 *
 * `admin/+layout.server.ts` calls this from its `load` for every page view. That
 * covers navigation, but SvelteKit runs a POST form action before any layout load
 * (the action belongs to the page's own +page.server.ts, not the layout), so a page
 * under this subtree that defines actions must call requireAdmin again at the top
 * of each one. The check itself still lives in exactly this one place either way.
 */
import { error, type Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const TOKEN_PARAM = 'token';
const TOKEN_COOKIE = 'canonry_admin_token';

interface AdminRequest {
	cookies: Cookies;
	url: URL;
	request: Request;
}

/**
 * Throws a 404 unless the request carries the configured ADMIN_TOKEN, supplied as
 * an `Authorization: Bearer` header, a `?token=` query parameter, or the cookie a
 * prior valid query parameter left behind. A token that arrives on the query
 * string is remembered in a cookie scoped to /admin, so the rest of the subtree -
 * every link and every form - does not need it threaded through by hand.
 */
export function requireAdmin(event: AdminRequest): void {
	const secret = env.ADMIN_TOKEN;
	if (!secret) error(404, 'Not Found');

	const bearerMatch = event.request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
	const queryToken = event.url.searchParams.get(TOKEN_PARAM);
	const supplied = bearerMatch?.[1] ?? queryToken ?? event.cookies.get(TOKEN_COOKIE);
	if (supplied !== secret) error(404, 'Not Found');

	if (queryToken) {
		event.cookies.set(TOKEN_COOKIE, secret, { path: '/admin' });
	}
}
