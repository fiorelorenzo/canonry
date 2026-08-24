/**
 * G1 = B (docs/design/DECISIONS.md): dark is a whole-app preference with three values,
 * and the third one, "Match system", resolves to **no `data-theme` attribute at all**
 * (`lib/theme.ts`, deliberately, so the setting keeps tracking a later OS change). So
 * neither palette arrives by a single selector condition, and CSS has no one rule for
 * either of them:
 *
 * - dark, chosen: `[data-theme='dark']` on `<html>`, written server side in
 *   `hooks.server.ts` so there is no flash;
 * - dark, not chosen: `@media (prefers-color-scheme: dark)` scoped to
 *   `html:not([data-theme])`;
 * - light, chosen: `[data-theme='light']`, which had no rule of its own at all until #738
 *   and therefore meant nothing;
 * - light, not chosen: the defaults `@theme` generates onto `:root, :host`.
 *
 * **Anything keyed off a palette belongs in every branch that palette arrives by, or in
 * none.** That is the whole of this file, and it exists because the rule has now been
 * broken once in each direction:
 *
 * - #137 shipped the media branch for the **tokens** and every palette token has had
 *   both dark branches ever since.
 * - `layout.css`'s `dark:` **custom variant** was not updated with it and named the
 *   attribute alone for eighteen rounds (#727). On the Match-system path the whole
 *   palette went dark and every `dark:` utility in the app stayed inert, so a GM who
 *   never opened Settings got form fields with no fill while a GM who had picked Dark
 *   got the filled ones. Neither rendering is wrong on its own, which is exactly why
 *   nobody caught it: the two paths were never compared to each other.
 *
 * The measurement half of #727 is worth keeping next to the rule, because it is why a
 * screenshot could not have caught this either. `uishot --theme dark` calls
 * `page.emulateMediaFeatures` and writes no cookie, so **every dark screenshot and
 * every dark axe run before #739 went down the media path** and therefore exercised
 * none of those utilities. The cookie is what decides once an account has chosen; the
 * two darks used to be two renderings and are one now.
 *
 * ## What this asserts, and why each one is the cheap version of a browser
 *
 * 1. **The variant carries both dark branches.** The narrow assertion #727 wanted:
 *    reverting the variant to a single-selector `@custom-variant dark (...)` fails here.
 * 2. **Every palette scope declares the same property names in the same order.** #137's
 *    invariant, widened to the light scope #738 added (#742). A token added to the two
 *    dark scopes and forgotten in the light one falls through to `:root` and is right by
 *    luck rather than by rule, which is the same defect as #727 one token at a time.
 * 3. **`@theme`'s own light defaults stay in step with `[data-theme='light']`.** Those
 *    two are light's two arrival conditions, so they are the light mirror of assertion 2.
 *    #742 hesitated over this one because comparing a subset of `@theme` needs a filter
 *    and a filter is where a stale exception hides; the filter here is
 *    `[data-theme='light']`'s own property list, so there is nothing to maintain and
 *    nothing to forget. Values are compared as well as names, because these two scopes
 *    are the one pair in the file that is meant to say the same thing twice.
 * 4. **Every `prefers-color-scheme` rule, of either value, excludes an explicit
 *    attribute.** A media rule that forgets `:not([data-theme])` repaints a GM who
 *    explicitly chose the other palette, which is the leak the third cookie state exists
 *    to catch. It is also the reason a media branch cannot simply be widened to "dark OS".
 *
 * ## What this cannot see
 *
 * It reads one file's text, so it holds that file's branches in step and nothing else. It
 * cannot tell you that a `dark:` utility renders, that the cascade resolves the way the
 * selector suggests, or that the result clears a contrast floor. Three specific edges,
 * because a guard whose limits nobody knows gets trusted past them:
 *
 * - **Cascade order is not asserted, and could not usefully be.** `@theme`'s output and
 *   the attribute scopes all land at specificity (0,1,0) in `@layer theme`, so only
 *   source order separates them, and that order is Tailwind's rather than this file's: a
 *   `@layer theme` block placed *above* the `@theme` block still compiles *after* it
 *   (measured on the built asset for #742, probe rule at byte 5898 against the theme
 *   output at 2229). An assertion on the order of the source would guard nothing.
 * - **The variant still crosses into a nested `[data-theme='light']` island** (#743), so
 *   with `<html>` dark a `dark:` utility fires inside `/dev/ui`'s light pane and paints
 *   the light value of the token it names. That is text this file could read, and it is
 *   deliberately not asserted, because the assertion would fail on `main`. Whoever
 *   closes #743 turns this bullet into assertion 5.
 * - **`app.html`'s `theme-color` metas are not CSS** and are not here. They key off the
 *   media query alone, which is the same class of defect in the other direction and is
 *   #740; `lib/theme.spec.ts` is where that pair is held to the palette, because a `<meta>`
 *   cannot read the attribute at all. `static/favicon.svg` keys off the media query too and
 *   is correct to, being a separate document with no access to the page.
 *
 * The browser half, for anything this cannot reach: six states on `/auth/sign-in` (OS
 * dark or light, cookie absent, `dark`, `light`), computed styles, cookies cleared
 * between them. All three dark states resolve `--color-paper: #17140f` with an input
 * fill of `#110e08`; all three light states resolve `#f4efe4` with no fill at all.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
/**
 * Comments are stripped before anything looks at the text. `layout.css` is more comment
 * than CSS and its prose quotes the very selectors and at-rules this file greps for
 * (`@theme`, `[data-theme='dark'] *`, `prefers-color-scheme`), so a matcher run over the
 * raw file measures a paragraph about the mechanism instead of the mechanism. Replaced
 * with a space rather than deleted, so two tokens either side of a comment cannot fuse.
 */
const CSS = readFileSync(`${SRC}routes/layout.css`, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Every block whose header matches, with its body brace-matched rather than
 * regex-matched, because both things this file looks at are nested: the token scope sits
 * inside `@layer theme`, and the variant's own media branch sits inside
 * `@custom-variant`. A single greedy regex reads the first `}` it finds and silently
 * measures the wrong text, which is how a guard passes while the file is wrong.
 */
function blocks(source: string, header: RegExp): { header: string; body: string }[] {
	const re = new RegExp(
		header.source,
		header.flags.includes('g') ? header.flags : `${header.flags}g`
	);
	const out: { header: string; body: string }[] = [];
	for (let match = re.exec(source); match; match = re.exec(source)) {
		const open = source.indexOf('{', match.index);
		let depth = 0;
		let i = open;
		for (; i < source.length; i++) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}' && --depth === 0) break;
		}
		out.push({ header: match[0].replace(/\s+/g, ' '), body: source.slice(open + 1, i) });
		re.lastIndex = i;
	}
	return out;
}

/** Custom property *names* declared directly in a block, in declaration order. */
function declared(body: string): string[] {
	return [...body.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

/** The same declarations as a name-to-value map, whitespace normalised. */
function declaredValues(body: string): Map<string, string> {
	return new Map(
		[...body.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:([^;{}]*);/g)].map((m) => [
			m[1],
			m[2].trim().replace(/\s+/g, ' ')
		])
	);
}

const MEDIA_DARK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/;
/** Either value, because the light one is the leak nobody has written yet. */
const MEDIA_SCHEME = /@media\s*\(prefers-color-scheme:\s*(?:dark|light)\)\s*\{/;

const variant = blocks(CSS, /@custom-variant\s+dark\s*\{/);
const mediaDarkBlocks = blocks(CSS, MEDIA_DARK);
const mediaSchemeBlocks = blocks(CSS, MEDIA_SCHEME);
const themeBlock = blocks(CSS, /@theme\s*\{/);
const attributeDark = blocks(CSS, /(?:^|\n)\s*\[data-theme='dark'\]\s*\{/);
const attributeLight = blocks(CSS, /(?:^|\n)\s*\[data-theme='light'\]\s*\{/);
/** The token half: the one `prefers-color-scheme` block that sets custom properties. */
const tokenMediaScope = mediaDarkBlocks
	.flatMap((b) => blocks(b.body, /html:not\(\[data-theme\]\)\s*\{/))
	.filter((b) => declared(b.body).length > 0);

/**
 * The three scopes that declare the whole palette and nothing else, named by what a
 * reader would grep for. `@theme` is the fourth arrival condition and is held to a
 * different assertion below, because it also carries the type scale, the radii, the
 * containers and the motion tokens and so cannot be compared whole.
 */
const paletteScopes = () => [
	{ name: "[data-theme='dark']", body: attributeDark[0].body },
	{ name: "[data-theme='light']", body: attributeLight[0].body },
	{
		name: '@media (prefers-color-scheme: dark) html:not([data-theme])',
		body: tokenMediaScope[0].body
	}
];

describe('layout.css parses the way this guard thinks it does', () => {
	it('found the file and every theme mechanism in it', () => {
		// A broken read or a broken walk would make every assertion below pass on nothing.
		expect(CSS.length).toBeGreaterThan(10_000);
		expect(variant).toHaveLength(1);
		expect(themeBlock).toHaveLength(1);
		expect(attributeDark).toHaveLength(1);
		expect(attributeLight).toHaveLength(1);
		expect(tokenMediaScope).toHaveLength(1);
		// Two of them: the variant's own branch, and the token block's. Both dark, which is
		// why the exclusion assertion below looks for either value rather than only this one.
		expect(mediaDarkBlocks).toHaveLength(2);
		expect(mediaSchemeBlocks).toHaveLength(2);
	});
});

describe('the dark: variant covers both ways dark arrives (#727)', () => {
	it('is a block with two branches, not a single selector', () => {
		// The single-selector form `@custom-variant dark (...)` declares no block at all,
		// so `blocks()` finds nothing and this is the assertion that catches a revert.
		expect(variant).toHaveLength(1);
		const [{ body }] = variant;
		expect(body.match(/@slot/g)).toHaveLength(2);
	});

	it('names the explicit attribute in one branch', () => {
		const [{ body }] = variant;
		const attribute = body.slice(
			0,
			body.search(MEDIA_DARK) >= 0 ? body.search(MEDIA_DARK) : body.length
		);
		expect(attribute).toMatch(/\[data-theme='dark'\]/);
		// The element itself and its descendants, or a `dark:` utility on <html> is missed.
		expect(attribute).toMatch(/\[data-theme='dark'\]\s*\*/);
	});

	it('names the no-attribute media path in the other, scoped the same way the tokens are', () => {
		const [{ body }] = variant;
		const [media] = blocks(body, MEDIA_DARK);
		expect(media).toBeDefined();
		expect(media.body).toMatch(/html:not\(\[data-theme\]\)/);
		expect(media.body).toMatch(/html:not\(\[data-theme\]\)\s*\*/);
		expect(media.body).toMatch(/@slot/);
	});

	it('adds no specificity in either branch, so a dark: utility still wins on source order', () => {
		// Both branches wrap their condition in :where(). If one of them stops doing that,
		// it outranks its own unprefixed sibling asymmetrically and the two paths diverge
		// again, in the cascade this time rather than in the selector.
		const [{ body }] = variant;
		expect(body.match(/:where\(/g)).toHaveLength(2);
	});
});

describe('every palette scope declares the same tokens (#137, #738)', () => {
	it('no scope carries a property another one is missing', () => {
		const scopes = paletteScopes();
		const reference = declared(scopes[0].body);
		const gaps: Record<string, { missing: string[]; extra: string[] }> = {};
		for (const scope of scopes) {
			const own = new Set(declared(scope.body));
			const missing = reference.filter((p) => !own.has(p));
			const extra = [...own].filter((p) => !reference.includes(p));
			if (missing.length || extra.length) gaps[scope.name] = { missing, extra };
		}
		// The object is the failure message: it names the scope and the property.
		expect(gaps).toEqual({});
		// Not a coincidence of empty sets: the palette plus shadcn's aliases.
		expect(reference.length).toBeGreaterThan(30);
	});

	it('declares them in the same order, so the scopes stay readable side by side', () => {
		const scopes = paletteScopes();
		const reference = declared(scopes[0].body);
		const orders = Object.fromEntries(scopes.map((s) => [s.name, declared(s.body)]));
		expect(orders).toEqual(Object.fromEntries(scopes.map((s) => [s.name, reference])));
	});
});

describe("@theme's light defaults stay in step with [data-theme='light'] (#738, #742)", () => {
	// Light's two arrival conditions, the mirror of the dark pair above. The property list
	// is taken from `[data-theme='light']` rather than authored here, so this comparison
	// has no exception list to go stale: #742's own reason for leaving it out.
	const lightProperties = () => declared(attributeLight[0].body);

	it('@theme declares every property the chosen-light scope does', () => {
		const inTheme = declaredValues(themeBlock[0].body);
		expect(lightProperties().filter((p) => !inTheme.has(p))).toEqual([]);
	});

	it('declares them with the same values, since the two scopes say the same thing twice', () => {
		const inTheme = declaredValues(themeBlock[0].body);
		const inLight = declaredValues(attributeLight[0].body);
		const differing: Record<string, { theme?: string; light?: string }> = {};
		for (const property of lightProperties()) {
			if (inTheme.get(property) !== inLight.get(property)) {
				differing[property] = { theme: inTheme.get(property), light: inLight.get(property) };
			}
		}
		expect(differing).toEqual({});
	});

	// Order is deliberately not compared: `@theme` interleaves the type scale, the
	// containers, the radii and the motion tokens between the palette's own declarations,
	// so the palette subset's order there is not the light scope's and never was.
});

describe('an explicit choice always outranks the OS preference', () => {
	it('every prefers-color-scheme rule, of either value, excludes an explicit data-theme', () => {
		// Otherwise a GM who chose Light on a dark machine gets repainted, which is the
		// state the third cookie state in #727 exists to prove does not happen. Either
		// value, because a future `prefers-color-scheme: light` block forgetting this
		// would repaint the GM who chose Dark, and that is the same bug mirrored.
		expect(mediaSchemeBlocks.length).toBeGreaterThan(0);
		for (const block of mediaSchemeBlocks) {
			expect(block.body).toMatch(/:not\(\[data-theme\]\)/);
		}
	});

	it('the token scope keeps its bare html:not([data-theme]), with no :where() around it', () => {
		// #137 proved this the hard way: @theme lands the light defaults on `:root, :host`
		// at specificity (0,1,0), and a zero-specificity :where() wrapper can never outrank
		// that, so the page rendered light on an emulated dark OS. The variant's branches
		// want :where() and this one must not have it, which is why they are two assertions
		// and not one.
		expect(tokenMediaScope[0].header).toMatch(/^html:not\(\[data-theme\]\)\s*\{$/);
	});
});
