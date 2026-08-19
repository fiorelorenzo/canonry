/**
 * The server half of the credential forms (#262): two pieces all three of them need, and
 * neither of which is worth writing out three times in three route files.
 *
 * `forwardAuthCookies` is what makes a server-side `auth.api.*` call actually sign the
 * browser in. Better Auth hands its session cookie back as a `Set-Cookie` header on its own
 * response rather than writing it anywhere SvelteKit can see, so a form action has to copy
 * it onto the outgoing response itself. `parseSetCookieHeader`/`toCookieOptions` come from
 * the installed package (`better-auth/cookies`, read in this checkout, not assumed), so
 * every attribute travels exactly as Better Auth set it - `HttpOnly`, `SameSite`, and
 * `Secure` only when the configured base URL is https, which is why this works unchanged
 * over plain http in dev and still hardens in preview and prod.
 *
 * `refuseCredentialQuery` deals with the wreckage the defect already left rather than with
 * the defect itself: a URL that carries a password in its query string, out of browser
 * history, out of a bookmark, or out of a crawler replaying one. Rendering that page would
 * hand the password to the `Referer` of everything the page then loads, so the load
 * redirects to the same page with those parameters dropped, before anything renders.
 */
import { redirect, type Cookies } from '@sveltejs/kit';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';

/**
 * Every field name a form in this app uses for a secret. A GET carrying one of these is
 * always a leak, never a legitimate request, whatever page it lands on.
 */
export const CREDENTIAL_QUERY_PARAMS: readonly string[] = [
	'password',
	'currentPassword',
	'newPassword',
	'confirmPassword'
];

/** A submitted field as a string, and an empty one for anything that is not one (a `File`,
 * a missing key), so a validation branch and a success branch can hand back the same shape. */
export function formString(data: FormData, key: string): string {
	const value = data.get(key);
	return typeof value === 'string' ? value : '';
}

/** Copies Better Auth's `Set-Cookie` headers onto the response SvelteKit is building. */
export function forwardAuthCookies(headers: Headers, cookies: Cookies): void {
	// One `Set-Cookie` value at a time: `headers.get('set-cookie')` joins them with a comma,
	// which is also what an `Expires=Wed, 21 Oct ...` attribute contains.
	for (const header of headers.getSetCookie()) {
		for (const [name, attributes] of parseSetCookieHeader(header)) {
			const { path, ...rest } = toCookieOptions(attributes);
			cookies.set(name, attributes.value, { ...rest, path: path ?? '/' });
		}
	}
}

/**
 * Redirects away from a URL whose query string carries a credential, keeping every other
 * parameter (`/auth/reset-password?token=...` needs its token to survive this).
 */
export function refuseCredentialQuery(url: URL): void {
	if (!CREDENTIAL_QUERY_PARAMS.some((param) => url.searchParams.has(param))) return;

	const kept = new URLSearchParams(url.search);
	for (const param of CREDENTIAL_QUERY_PARAMS) kept.delete(param);
	const query = kept.toString();
	redirect(303, query.length > 0 ? `${url.pathname}?${query}` : url.pathname);
}
