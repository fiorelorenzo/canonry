import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	applyThemePreference,
	isThemePreference,
	parseThemePreference,
	themeAttribute,
	type ThemePreference
} from './theme';

describe('isThemePreference', () => {
	it('accepts the three legal values', () => {
		expect(isThemePreference('light')).toBe(true);
		expect(isThemePreference('dark')).toBe(true);
		expect(isThemePreference('system')).toBe(true);
	});

	it('rejects anything else, including null and undefined', () => {
		expect(isThemePreference('sepia')).toBe(false);
		expect(isThemePreference(null)).toBe(false);
		expect(isThemePreference(undefined)).toBe(false);
	});
});

describe('parseThemePreference', () => {
	it('passes a legal cookie value through', () => {
		expect(parseThemePreference('dark')).toBe('dark');
	});

	it('falls back to system for a missing or garbled cookie', () => {
		expect(parseThemePreference(undefined)).toBe('system');
		expect(parseThemePreference(null)).toBe('system');
		expect(parseThemePreference('nope')).toBe('system');
	});
});

describe('themeAttribute', () => {
	it('passes light and dark straight through as the data-theme value', () => {
		expect(themeAttribute('light')).toBe('light');
		expect(themeAttribute('dark')).toBe('dark');
	});

	it('resolves system to no attribute, leaving the choice to CSS', () => {
		expect(themeAttribute('system')).toBeUndefined();
	});
});

/**
 * `applyThemePreference` is three string replaces against one authored file, and a string
 * replace that stops matching is silent: the page still renders, with the wrong chrome or
 * the wrong palette. So these read the real `app.html` rather than a fixture. A rename of
 * `data-theme-pref`, a reordered attribute on either `theme-color` meta, or a change of
 * quoting in any of the three is a failure here rather than a defect somebody notices on a
 * phone.
 */
const APP_HTML = readFileSync(fileURLToPath(new URL('../app.html', import.meta.url)), 'utf-8');

/** The `media` value of each `theme-color` meta, keyed by the colour it carries. */
function themeColorMedia(html: string): Record<string, string | null> {
	const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]);
	return Object.fromEntries(
		metas.map((meta) => [
			/content="([^"]*)"/.exec(meta)?.[1] ?? '?',
			/media="([^"]*)"/.exec(meta)?.[1] ?? null
		])
	);
}

const LIGHT_CHROME = '#f4efe4';
const DARK_CHROME = '#17140f';

describe('applyThemePreference against the real app.html', () => {
	it('finds all three things it rewrites, so a rename fails here', () => {
		expect(APP_HTML).toContain(' data-theme-pref');
		expect(themeColorMedia(APP_HTML)).toEqual({
			[LIGHT_CHROME]: '(prefers-color-scheme: light)',
			[DARK_CHROME]: '(prefers-color-scheme: dark)'
		});
	});

	it('writes the chosen palette onto <html> and drops the placeholder', () => {
		expect(applyThemePreference(APP_HTML, 'dark')).toContain('<html lang="en" data-theme="dark">');
		expect(applyThemePreference(APP_HTML, 'light')).toContain(
			'<html lang="en" data-theme="light">'
		);
		expect(applyThemePreference(APP_HTML, 'system')).toContain('<html lang="en">');
		// Only the tag, not the document: the comment at the top of `app.html`'s head names
		// `data-theme-pref` in prose on purpose, and `replace` touches the first match only,
		// which is exactly why that comment has to sit after the attribute it describes.
		for (const preference of ['light', 'dark', 'system'] as const) {
			const tag = /<html[^>]*>/.exec(applyThemePreference(APP_HTML, preference))?.[0];
			expect(tag).not.toContain('data-theme-pref');
		}
	});

	it('leaves exactly one theme-color meta applicable, and it is the chosen one (#740)', () => {
		// `all` always matches and `not all` never does, so this is the whole of the fix:
		// the browser has one candidate and it agrees with the palette under it.
		expect(themeColorMedia(applyThemePreference(APP_HTML, 'dark'))).toEqual({
			[LIGHT_CHROME]: 'not all',
			[DARK_CHROME]: 'all'
		});
		expect(themeColorMedia(applyThemePreference(APP_HTML, 'light'))).toEqual({
			[LIGHT_CHROME]: 'all',
			[DARK_CHROME]: 'not all'
		});
	});

	it('leaves both OS queries alone for Match system, which is the case they are right for', () => {
		expect(themeColorMedia(applyThemePreference(APP_HTML, 'system'))).toEqual(
			themeColorMedia(APP_HTML)
		);
	});

	it('changes something for every preference, so no branch is a silent no-op', () => {
		const preferences: ThemePreference[] = ['light', 'dark', 'system'];
		for (const preference of preferences) {
			expect(applyThemePreference(APP_HTML, preference)).not.toBe(APP_HTML);
		}
	});
});

/**
 * The two colours above are the one place in the app that restates a palette value outside
 * `layout.css`, and they have to: a `<meta>` cannot read a custom property, so `#f4efe4`
 * and `#17140f` are literals in `app.html` and nothing in CSS can keep them honest. This
 * is what keeps them honest instead. `--light-paper` and `--dark-paper` are what the page
 * under the browser chrome is actually painted with (`layout.css`'s `@layer base` sets
 * `html`'s background to `--color-paper`), so a repaint that moves either one and leaves
 * `app.html` alone is a browser frame that no longer matches the page inside it.
 */
describe("the theme-color metas carry the palette's own paper", () => {
	const LAYOUT_CSS = readFileSync(
		fileURLToPath(new URL('../routes/layout.css', import.meta.url)),
		'utf-8'
	);
	const literal = (token: string) =>
		new RegExp(`--${token}:\\s*(#[0-9a-f]{3,8})\\s*;`).exec(LAYOUT_CSS)?.[1];

	it('matches --light-paper and --dark-paper exactly', () => {
		expect(literal('light-paper')).toBe(LIGHT_CHROME);
		expect(literal('dark-paper')).toBe(DARK_CHROME);
	});
});
