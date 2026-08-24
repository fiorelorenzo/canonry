/**
 * G1 = B (docs/design/DECISIONS.md): dark is a whole-app preference, not a table-mode skin.
 * This is the one place that knows the cookie name, the three legal values, and how a
 * preference resolves to what `app.html` carries before first paint: the `data-theme`
 * attribute `layout.css`'s `[data-theme='dark']` variant reads, and the two `theme-color`
 * metas the browser paints its own chrome from (#740). `src/hooks.server.ts` and
 * `routes/settings/appearance` both import from here instead of repeating the string.
 *
 * `system` resolves to `undefined` below, meaning "no attribute at all" - deliberately,
 * since guessing the browser's preference here and writing it back as an explicit
 * `data-theme` would collapse `system` into whichever of `light`/`dark` the OS happened
 * to report at cookie-write time, and the setting would stop tracking a later OS change.
 * `layout.css` carries the other half (#137): a `prefers-color-scheme: dark` media query,
 * scoped to `html:not([data-theme])`, mirrors `[data-theme='dark']`'s custom properties
 * without a second copy of their hex values, so "no attribute" still renders dark on a
 * dark machine and light on a light one, live, with no reload.
 */

export const THEME_COOKIE = 'canonry_theme';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
	return value != null && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** A missing or unrecognised cookie behaves exactly like an explicit `system` choice. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
	return isThemePreference(raw) ? raw : 'system';
}

/**
 * `light`/`dark` become the `data-theme` attribute written before first paint.
 * `system` resolves to `undefined`, meaning "no attribute at all", so nothing here
 * ever guesses at the browser's preference; CSS is left to decide once it can.
 */
export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | undefined {
	return preference === 'system' ? undefined : preference;
}

/**
 * The `media` attribute each of `app.html`'s two `theme-color` metas is authored with.
 * That pair is exactly right for "Match system", and it is also the only thing available
 * with no request behind the render, which is why it stays the file's static default
 * rather than being generated.
 */
const OS_THEME_COLOR_MEDIA = {
	light: '(prefers-color-scheme: light)',
	dark: '(prefers-color-scheme: dark)'
} as const;

/** The two palettes a `theme-color` meta can carry, which is also its marker attribute. */
export type Palette = 'light' | 'dark';

/**
 * The `media` one `theme-color` meta must carry for a resolved preference. Both halves of
 * the rewrite below go through this, so the server-rendered document and the live one
 * cannot disagree about a palette (#752): `all` always matches, `not all` never does, and
 * `system` hands the question back to the OS query the file was authored with.
 */
export function themeColorMedia(preference: ThemePreference, palette: Palette): string {
	if (preference === 'system') return OS_THEME_COLOR_MEDIA[palette];
	return preference === palette ? 'all' : 'not all';
}

/**
 * Everything a resolved preference changes about the document `app.html` describes, in one
 * place so the string replaces can be tested against the real file rather than reasoned
 * about. `hooks.server.ts` calls this from `transformPageChunk` and adds only the locale
 * swap, which is not a theme concern.
 *
 * #740 is the second half. A `<meta>` cannot read `[data-theme]` and CSS cannot reach a
 * meta tag, so the two `theme-color` metas were selected by the OS preference and nothing
 * else: a GM who chose Light on a dark machine got dark browser chrome over a light page,
 * and the reverse. The browser reads them before any of our JavaScript runs, so the answer
 * has to be server side or the chrome flashes the wrong colour on every load.
 *
 * The rewrite moves each meta's media query rather than adding or removing a meta, so
 * exactly one of the two applies in every case and nothing here depends on how a UA breaks
 * a tie between two matching `theme-color` metas.
 */
export function applyThemePreference(html: string, preference: ThemePreference): string {
	const attribute = themeAttribute(preference);
	const themed = attribute
		? html.replace('data-theme-pref', `data-theme="${attribute}"`)
		: html.replace(' data-theme-pref', '');

	return themed
		.replace(
			`media="${OS_THEME_COLOR_MEDIA.light}"`,
			`media="${themeColorMedia(preference, 'light')}"`
		)
		.replace(
			`media="${OS_THEME_COLOR_MEDIA.dark}"`,
			`media="${themeColorMedia(preference, 'dark')}"`
		);
}

/**
 * The same transform against a live document, which is what makes the appearance setting
 * take effect without a reload (#752).
 *
 * `app.html` is rendered once per document and nothing re-renders it, so before this the
 * setting wrote its cookie and repainted nothing: `data-theme` stayed as it was for the
 * rest of the session, through every client-side navigation, until a full document load.
 * Measured on `/settings/appearance` with a light OS, choosing Dark left
 * `--color-paper` at `#f4efe4` and `performance.getEntriesByType('navigation').length` at
 * 1, so a GM picked a theme and watched nothing happen.
 *
 * The metas are found by their `data-theme-color` marker rather than by their media query,
 * because the query is the thing being rewritten and would only be findable the first time.
 * Both halves share `themeColorMedia`, so there is one rule and two ways to apply it.
 */
export function applyThemePreferenceToDocument(doc: Document, preference: ThemePreference): void {
	const attribute = themeAttribute(preference);
	if (attribute) doc.documentElement.setAttribute('data-theme', attribute);
	else doc.documentElement.removeAttribute('data-theme');

	for (const palette of ['light', 'dark'] as const) {
		doc
			.querySelector(`meta[name='theme-color'][data-theme-color='${palette}']`)
			?.setAttribute('media', themeColorMedia(preference, palette));
	}
}
