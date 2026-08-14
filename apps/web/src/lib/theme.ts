/**
 * G1 = B (docs/ux/DECISIONS.md): dark is a whole-app preference, not a table-mode skin.
 * This is the one place that knows the cookie name, the three legal values, and how a
 * preference resolves to the `data-theme` attribute `layout.css`'s
 * `[data-theme='dark']` variant reads. `src/hooks.server.ts` and
 * `routes/settings/appearance` both import from here instead of repeating the string.
 *
 * Known gap, out of #104's owned paths: `layout.css` currently only defines
 * `[data-theme='dark']`, no `@media (prefers-color-scheme: dark)` fallback. `system`
 * resolving to "no attribute" is correct and is what this module does; until
 * layout.css grows that media query (mirroring the same custom properties under a
 * media condition instead of an attribute selector), a `system` preference on a
 * dark-OS machine still renders the light palette. Flagged rather than worked around
 * here, since faking it would mean hardcoding the dark palette's hex values a second
 * time in a file that is not the one source of truth for them.
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
