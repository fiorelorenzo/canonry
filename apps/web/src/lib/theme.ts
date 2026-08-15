/**
 * G1 = B (docs/ux/DECISIONS.md): dark is a whole-app preference, not a table-mode skin.
 * This is the one place that knows the cookie name, the three legal values, and how a
 * preference resolves to the `data-theme` attribute `layout.css`'s
 * `[data-theme='dark']` variant reads. `src/hooks.server.ts` and
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
