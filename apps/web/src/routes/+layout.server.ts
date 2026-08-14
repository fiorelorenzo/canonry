/**
 * Resolves the theme cookie once for every route, so a page that wants to reflect the
 * current preference (the settings form's default-checked radio) reads it from
 * `await parent()` instead of re-parsing the cookie itself.
 *
 * Also the one place `locals.user` becomes page data (issue #86): the shell's
 * sign-in status reads `data.user` from here rather than every layout re-deriving it,
 * same reasoning as the theme preference above. Only the fields a template needs ever
 * cross into page data - never the session id or anything else `locals.session` carries.
 */
import { parseThemePreference, THEME_COOKIE } from '$lib/theme';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies, locals }) => {
	return {
		themePreference: parseThemePreference(cookies.get(THEME_COOKIE)),
		user: locals.user
			? { id: locals.user.id, name: locals.user.name, email: locals.user.email }
			: null
	};
};
