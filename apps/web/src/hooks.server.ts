/**
 * G1 = B (docs/ux/DECISIONS.md): dark is a whole-app preference, decided here rather
 * than guessed in the browser, so the very first paint already carries the right
 * palette. `app.html` carries a `data-theme-pref` placeholder attribute on `<html>`;
 * this hook reads the `canonry_theme` cookie once per request and rewrites that
 * placeholder before any byte reaches the client, which is what rules out a flash of
 * the wrong palette. When the cookie says `system` or is missing, the attribute is
 * dropped entirely rather than guessed, and `layout.css` is left to decide (see the
 * known gap noted in `$lib/theme.ts`).
 */
import { parseThemePreference, THEME_COOKIE, themeAttribute } from '$lib/theme';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const preference = parseThemePreference(event.cookies.get(THEME_COOKIE));
	const attribute = themeAttribute(preference);

	return resolve(event, {
		transformPageChunk: ({ html }) =>
			attribute
				? html.replace('data-theme-pref', `data-theme="${attribute}"`)
				: html.replace(' data-theme-pref', '')
	});
};
