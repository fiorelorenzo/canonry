/**
 * Resolves the theme cookie once for every route, so a page that wants to reflect the
 * current preference (the settings form's default-checked radio) reads it from
 * `await parent()` instead of re-parsing the cookie itself.
 *
 * Also the one place `locals.user` becomes page data (issue #86): the shell's
 * sign-in status reads `data.user` from here rather than every layout re-deriving it,
 * same reasoning as the theme preference above. Only the fields a template needs ever
 * cross into page data - never the session id or anything else `locals.session` carries.
 *
 * `locale` (issue #120, SPEC.md §17) is `locals.locale`, already resolved once in
 * hooks.server.ts - every nested route's load function and every `.svelte` component
 * reads it from `data.locale` (SvelteKit merges every layout's returned data down the
 * tree) rather than re-negotiating it. Only the resolved `Locale` string crosses into
 * page data, never the message catalogue itself: `Messages` is half functions, which
 * `devalue` (SvelteKit's data serializer) cannot carry across the server/client
 * boundary - every consumer calls `messages(data.locale)` itself instead.
 *
 * `origin` rides the same event `url` that `adapter-node` rewrites from `ORIGIN` in
 * production (see `$lib/server/auth.ts`'s own `env.ORIGIN` read) - the root layout's
 * Open Graph image tag needs an absolute URL and this is the one place that origin is
 * already correct for every environment, dev included, without hardcoding a domain.
 */
import { parseThemePreference, THEME_COOKIE } from '$lib/theme';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies, locals, url }) => {
	return {
		themePreference: parseThemePreference(cookies.get(THEME_COOKIE)),
		user: locals.user
			? { id: locals.user.id, name: locals.user.name, email: locals.user.email }
			: null,
		locale: locals.locale,
		origin: url.origin
	};
};
