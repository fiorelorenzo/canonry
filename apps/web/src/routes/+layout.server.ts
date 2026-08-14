/**
 * Resolves the theme cookie once for every route, so a page that wants to reflect the
 * current preference (the settings form's default-checked radio) reads it from
 * `await parent()` instead of re-parsing the cookie itself.
 */
import { parseThemePreference, THEME_COOKIE } from '$lib/theme';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	return { themePreference: parseThemePreference(cookies.get(THEME_COOKIE)) };
};
