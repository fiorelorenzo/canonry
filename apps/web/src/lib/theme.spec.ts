import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	applyThemePreference,
	isThemePreference,
	parseThemePreference,
	themeAttribute,
	themeColorMedia,
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
 * `data-theme-pref` or `data-theme-color`, or a change of quoting in any of the three
 * targets, is a failure here rather than a defect somebody notices on a phone.
 */
const APP_HTML = readFileSync(fileURLToPath(new URL('../app.html', import.meta.url)), 'utf-8');

/**
 * Each `theme-color` meta keyed by its `data-theme-color` marker, which is also how the
 * live-document half finds them (#752). `[^>]` crosses newlines, so this holds whether the
 * attributes sit on one line or four.
 */
function themeColorMetas(html: string): Record<string, { media?: string; content?: string }> {
	const metas = [...html.matchAll(/<meta\b[^>]*name="theme-color"[^>]*>/g)].map((m) => m[0]);
	return Object.fromEntries(
		metas.map((meta) => [
			/data-theme-color="([^"]*)"/.exec(meta)?.[1] ?? '?',
			{
				media: /media="([^"]*)"/.exec(meta)?.[1],
				content: /content="([^"]*)"/.exec(meta)?.[1]
			}
		])
	);
}

/** The `media` per marker, which is the only thing the rewrite moves. */
const mediaByPalette = (html: string): Record<string, string | undefined> =>
	Object.fromEntries(Object.entries(themeColorMetas(html)).map(([k, v]) => [k, v.media]));

const LIGHT_CHROME = '#f4efe4';
const DARK_CHROME = '#17140f';

describe('themeColorMedia', () => {
	it('makes the chosen palette unconditional and the other unreachable', () => {
		expect(themeColorMedia('dark', 'dark')).toBe('all');
		expect(themeColorMedia('dark', 'light')).toBe('not all');
		expect(themeColorMedia('light', 'light')).toBe('all');
		expect(themeColorMedia('light', 'dark')).toBe('not all');
	});

	it('hands the question back to the OS for Match system', () => {
		expect(themeColorMedia('system', 'light')).toBe('(prefers-color-scheme: light)');
		expect(themeColorMedia('system', 'dark')).toBe('(prefers-color-scheme: dark)');
	});
});

describe('applyThemePreference against the real app.html', () => {
	it('finds everything it rewrites, so a rename fails here', () => {
		expect(APP_HTML).toContain(' data-theme-pref');
		// Both markers present, each on the meta carrying that palette's own paper, because
		// the live-document half selects on the marker and the colour is what it paints.
		expect(themeColorMetas(APP_HTML)).toEqual({
			light: { media: '(prefers-color-scheme: light)', content: LIGHT_CHROME },
			dark: { media: '(prefers-color-scheme: dark)', content: DARK_CHROME }
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
		expect(mediaByPalette(applyThemePreference(APP_HTML, 'dark'))).toEqual({
			light: 'not all',
			dark: 'all'
		});
		expect(mediaByPalette(applyThemePreference(APP_HTML, 'light'))).toEqual({
			light: 'all',
			dark: 'not all'
		});
	});

	it('leaves both OS queries alone for Match system, which is the case they are right for', () => {
		expect(themeColorMetas(applyThemePreference(APP_HTML, 'system'))).toEqual(
			themeColorMetas(APP_HTML)
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
