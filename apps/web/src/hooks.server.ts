/**
 * Two things every request goes through, composed in one `handle`: the theme rewrite
 * (G1) that already lived here, and Better Auth's session resolution and request
 * interception (issue #86).
 *
 * `svelteKitHandler` (from `better-auth/svelte-kit`) matches the request URL against
 * `/api/auth/*` and, when it matches, calls `auth.handler` directly instead of `resolve`
 * - that is the entire SvelteKit mount, no catch-all route file needed (see the doc
 * comment on `$lib/server/auth.ts`). For every other path it falls through to the
 * `resolve` passed in below, which is the same theme-rewriting resolve this file always
 * used, untouched.
 *
 * `event.locals.session`/`user` are populated before that branch, from the session
 * cookie via `auth.api.getSession`, so both are already on `locals` by the time either
 * branch runs - a route loader, a form action and the auth handler itself all see the
 * same thing.
 */
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { parseThemePreference, THEME_COOKIE, themeAttribute } from '$lib/theme';
import type { Handle } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const handle: Handle = async ({ event, resolve }) => {
	const session = building ? null : await auth.api.getSession({ headers: event.request.headers });
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;

	return svelteKitHandler({
		auth,
		event,
		building,
		resolve: (innerEvent) => {
			const preference = parseThemePreference(innerEvent.cookies.get(THEME_COOKIE));
			const attribute = themeAttribute(preference);

			return resolve(innerEvent, {
				transformPageChunk: ({ html }) =>
					attribute
						? html.replace('data-theme-pref', `data-theme="${attribute}"`)
						: html.replace(' data-theme-pref', '')
			});
		}
	});
};
