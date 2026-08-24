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
 * - light, not chosen: the defaults `@theme` generates onto `:root, :host`, which is what
 *   most people are actually looking at.
 *
 * **Anything keyed off dark belongs in both branches or in neither.** That is the whole
 * of this file, and it exists because the rule has now been broken once in each
 * direction:
 *
 * - #137 shipped the media branch for the **tokens** and every palette token has had
 *   both ever since.
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
 * every dark axe run in this repo's history went down the media path** and therefore
 * exercised none of those utilities. The cookie is what decides once an account has
 * chosen (`AGENTS.md` says so now); the two darks are two renderings.
 *
 * ## What this asserts, and why each one is the cheap version of a browser
 *
 * 1. **The variant carries both branches.** The narrow assertion #727 wanted: reverting
 *    line 38 to a single-selector `@custom-variant dark (...)` fails here.
 * 2. **Every palette scope declares the same property names.** #137's invariant, which
 *    nothing guarded. A token added to `[data-theme='dark']` and forgotten in the media
 *    block is a property that is dark for a chosen theme and light for Match system,
 *    which is #727 again one token at a time. This shipped comparing the two dark scopes,
 *    because two was all the file had; #738 added `[data-theme='light']` an hour later so
 *    the gallery's light column could be light, and #742 widened this to the set, since a
 *    third scope nobody compares is the same silence again. That scope earns its place on
 *    its own merit rather than as symmetry: it is what an explicit Light choice renders,
 *    so a property missing from it falls through to `:root` and is right by luck.
 * 3. **`@theme`'s own light defaults stay in step with `[data-theme='light']`.** The
 *    fourth cell of the table above, and the last one to be guarded (#754). #742 and #747
 *    both left it out for the same reason: `@theme` also carries the fonts, the type
 *    scale, the containers, the radii and the motion tokens, so the comparison needs a
 *    filter down to the palette subset, and a filter is where a stale exception hides.
 *    That is true of an *authored* filter. This one is `[data-theme='light']`'s own
 *    property list, so there is nothing to maintain: a token added to the light scope is
 *    required in `@theme` from that moment, and one removed stops being required. Values
 *    are compared as well as names, because since #738 those two scopes both read
 *    `--light-*` and are meant to restate each other exactly. Order is not compared,
 *    because `@theme` interleaves the non-palette tokens between the palette's own
 *    declarations and always did.
 * 4. **Every `prefers-color-scheme` rule, of either value, excludes an explicit
 *    attribute.** A media rule that forgets `:not([data-theme])` repaints a GM who
 *    explicitly chose the other palette, which is the leak the third cookie state exists
 *    to catch. It is also the reason a media branch cannot simply be widened to "dark OS".
 *    Either value rather than only `dark`, because a `prefers-color-scheme: light` block
 *    that forgot it would repaint the GM who chose Dark, and that would pass unnoticed.
 * 5. **Both branches of the variant exclude a light island under their own dark root.**
 *    #743: the two dark conditions above say "this document is in dark", and a variant has
 *    to mean "this element is in dark". The token half never had the bug, because a custom
 *    property is declared on the element and inheritance resolves the nearest scope for
 *    free; a selector about `<html>` keeps matching straight through a
 *    `[data-theme='light']` subtree. The flat exclusion both #743 and #749 proposed is
 *    asserted *against* here rather than for: `:not([data-theme='light'], ...)` unanchored
 *    also excludes the gallery's dark column whenever `<html>` is the light scope, which is
 *    measured, so each branch anchors its exclusion to the same root its positive half is
 *    anchored to.
 *
 * ## What this cannot see
 *
 * It reads one file's text, so it holds the palette scopes of `layout.css` in step and
 * nothing else. It cannot tell you that a `dark:` utility renders, that the cascade
 * resolves the way the selector suggests, or that the result clears a contrast floor:
 * #727 verified all three in a browser across three cookie states, #743 did it again
 * across six, and this is the part of that which is cheap enough to run on every push.
 * Three specific edges, because a guard whose limits nobody knows gets trusted past them:
 *
 * - **Cascade order is not asserted, and #754 measured that it could not usefully be.**
 *   `@theme`'s output and both attribute scopes land at specificity (0,1,0) in
 *   `@layer theme`, so only source order separates them, which reads like something this
 *   file should pin. It is not ours to pin: a probe `@layer theme` block inserted *above*
 *   the `@theme` block still compiles *after* it, at byte 5898 against the theme output at
 *   2229 in the built asset, because Tailwind emits that output at the `@import` position
 *   regardless. An assertion on the source order would guard nothing while reading as
 *   though it guarded the thing that decides which palette wins.
 * - **The island exclusion is depth-limited, and no selector can lift that.** Assertion 5
 *   holds the two branches to excluding a light island one level below their own dark
 *   root, which is every level the app has, `<html>` plus one `<section data-theme>` in
 *   the two dev galleries. CSS cannot quantify over the path between two ancestors, so a
 *   third level (`dark > light > dark`) reads the wrong scope again and every assertion
 *   here still passes. A future surface that nests deeper is the first thing to check, and
 *   the depth-free spelling is the style query named in `layout.css`'s own comment, which
 *   is not written yet for the browser-support reason recorded there.
 * - **`app.html`'s two `theme-color` metas and `static/favicon.svg`** are selected by a
 *   media query rather than by the attribute, and a `<meta>` cannot read the attribute at
 *   all, so this file has no way to hold either of them in step with anything. #740 is the
 *   metas' own answer and `lib/theme.spec.ts` is where they end up held to the palette;
 *   the favicon is correct as it stands, being a separate document with no access to the
 *   page.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
/**
 * Comments are stripped before anything looks at the text (#754). `layout.css` is more
 * comment than CSS and its prose quotes the very selectors and at-rules this file greps
 * for, so a matcher can measure a paragraph about the mechanism instead of the mechanism:
 * the first `@theme` in the file, in reading order, is inside a comment. Replaced with a
 * space rather than deleted, so two tokens either side of a comment cannot fuse.
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

/**
 * The selector with every balanced `:where(...)` group removed, so what is left is
 * whatever the variant still contributes to specificity. Depth-aware rather than a
 * regex, because the exclusions nest `:not(...)` inside `:where(...)` and a non-greedy
 * regex stops at the first `)`, which is inside the argument rather than after it.
 */
function stripWhere(selector: string): string {
	let out = '';
	for (let i = 0; i < selector.length;) {
		if (selector.startsWith(':where(', i)) {
			let depth = 0;
			let j = i + ':where'.length;
			for (; j < selector.length; j++) {
				if (selector[j] === '(') depth++;
				else if (selector[j] === ')' && --depth === 0) break;
			}
			i = j + 1;
			continue;
		}
		out += selector[i];
		i++;
	}
	return out.trim();
}

/**
 * Each branch's own selector text, on one line. The variant's body is `<selector> {
 * @slot; }` twice, once bare and once inside the media block, so the selector is
 * everything before that rule's first brace.
 */
function branchSelectors(): { attribute: string; media: string } {
	const [{ body }] = variant;
	const selectorOf = (text: string) => text.slice(0, text.indexOf('{')).replace(/\s+/g, ' ').trim();
	const mediaAt = body.search(MEDIA_DARK);
	const [media] = blocks(body, MEDIA_DARK);
	return {
		attribute: selectorOf(body.slice(0, mediaAt)),
		media: selectorOf(media.body)
	};
}

const MEDIA_DARK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/;
/** Either value, because the light one is the leak nobody has written yet. */
const MEDIA_SCHEME = /@media\s*\(prefers-color-scheme:\s*(?:dark|light)\)\s*\{/;

const variant = blocks(CSS, /@custom-variant\s+dark\s*\{/);
const mediaDarkBlocks = blocks(CSS, MEDIA_DARK);
const mediaSchemeBlocks = blocks(CSS, MEDIA_SCHEME);
const themeBlock = blocks(CSS, /@theme\s*\{/);
const attributeScope = blocks(CSS, /(?:^|\n)\s*\[data-theme='dark'\]\s*\{/);
const lightAttributeScope = blocks(CSS, /(?:^|\n)\s*\[data-theme='light'\]\s*\{/);
/** The token half: the one `prefers-color-scheme` block that sets custom properties. */
const tokenMediaScope = mediaDarkBlocks
	.flatMap((b) => blocks(b.body, /html:not\(\[data-theme\]\)\s*\{/))
	.filter((b) => declared(b.body).length > 0);

/**
 * Every scope that repaints the palette, by the name a failure should print. #739 shipped
 * this guard with two, because two was all `layout.css` had; #738 added
 * `[data-theme='light']` an hour later so the gallery's light column could be light, and
 * a third scope nobody compares is the same silence this file exists to break (#742).
 * `[data-theme='light']` matters in its own right rather than as symmetry: it is what a GM
 * who explicitly chose Light gets, so a property missing from it falls through to `:root`
 * and is correct by luck instead of by rule.
 */
const paletteScopes = (): Record<string, string[]> => ({
	"[data-theme='dark']": declared(attributeScope[0].body),
	"[data-theme='light']": declared(lightAttributeScope[0].body),
	'@media (prefers-color-scheme: dark) html:not([data-theme])': declared(tokenMediaScope[0].body)
});

describe('layout.css parses the way this guard thinks it does', () => {
	it('found the file and every theme mechanism in it', () => {
		// A broken read or a broken walk would make every assertion below pass on nothing.
		expect(CSS.length).toBeGreaterThan(10_000);
		expect(variant).toHaveLength(1);
		expect(themeBlock).toHaveLength(1);
		expect(attributeScope).toHaveLength(1);
		expect(tokenMediaScope).toHaveLength(1);
		expect(lightAttributeScope).toHaveLength(1);
		// Two of them now: the variant's own branch, and the token block's. Both dark, which
		// is why the exclusion below looks for either value rather than only for this one.
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
		// Every condition either branch adds sits inside a :where(), so the variant weighs
		// nothing and a `dark:` utility beats its unprefixed sibling on source order alone.
		// Asserted structurally rather than by counting `:where(` occurrences, which is what
		// this used to do: a count is also satisfied by the wrong two and, worse, it fails on
		// any correct change to the selector, so #743's fix had to edit this line to land.
		// `:not()` takes its most specific argument's weight, so an exclusion that escapes
		// its wrapper is exactly the regression this catches.
		for (const [name, selector] of Object.entries(branchSelectors())) {
			expect(stripWhere(selector), `${name} branch, outside :where()`).toBe('&');
		}
	});
});

describe('the dark: variant does not reach into a light island (#743)', () => {
	it('excludes the island element and its descendants, in both branches', () => {
		// The same `(X, X *)` shape the positive half uses: the light `<section>` itself is
		// in light, not only what is inside it.
		const { attribute, media } = branchSelectors();
		expect(attribute).toMatch(
			/:not\(\s*\[data-theme='dark'\] \[data-theme='light'\], \[data-theme='dark'\] \[data-theme='light'\] \*\s*\)/
		);
		expect(media).toMatch(
			/:not\(\s*html:not\(\[data-theme\]\) \[data-theme='light'\], html:not\(\[data-theme\]\) \[data-theme='light'\] \*\s*\)/
		);
	});

	it('anchors each exclusion to its own branch root, never flatly', () => {
		// The flat form is the one both #743 and #749 proposed and the one that is wrong:
		// `<html data-theme='light'>` is itself a light scope, so an unanchored exclusion
		// also switches the gallery's *dark* column off whenever the GM has chosen Light.
		// Measured on this branch before the fix: the dark pane's first input went from
		// `#110e08` to no fill at all in both cookie=light rows. The two branches therefore
		// cannot share one exclusion, which is the one place the "both branches or neither"
		// rule above needs a different spelling per branch rather than the same one twice.
		for (const [name, selector] of Object.entries(branchSelectors())) {
			expect(selector, `${name} branch carries the flat exclusion`).not.toMatch(
				/:not\(\s*\[data-theme='light'\]/
			);
		}
	});
});

describe('every palette scope declares the same tokens (#137, #742)', () => {
	it('no scope carries a property another one is missing', () => {
		const scopes = paletteScopes();
		const union = [...new Set(Object.values(scopes).flat())];
		// Reported per scope rather than as one boolean, so a failure names the block and
		// the property instead of leaving the reader to diff two 38-line CSS scopes by eye.
		const missing = Object.fromEntries(
			Object.entries(scopes)
				.map(([name, props]) => [name, union.filter((p) => !props.includes(p))] as const)
				.filter(([, gap]) => gap.length > 0)
		);
		expect(missing).toEqual({});
		// Not a coincidence of empty sets: the palette plus shadcn's aliases, in each scope.
		expect(union.length).toBeGreaterThan(30);
	});

	it('declares them in the same order, so the blocks stay readable side by side', () => {
		const [reference, ...rest] = Object.entries(paletteScopes());
		for (const [name, props] of rest) {
			expect(props, `${name} against ${reference[0]}`).toEqual(reference[1]);
		}
	});
});

describe("@theme's light defaults stay in step with [data-theme='light'] (#754)", () => {
	// Light's other arrival condition, and the mirror of the dark pair above. The property
	// list is taken from `[data-theme='light']` rather than authored here, so this
	// comparison has no exception list to go stale, which is why #742 and #747 left it out.
	const lightProperties = () => declared(lightAttributeScope[0].body);

	it('@theme declares every property the chosen-light scope does', () => {
		const inTheme = declaredValues(themeBlock[0].body);
		expect(lightProperties().filter((p) => !inTheme.has(p))).toEqual([]);
	});

	it('declares them with the same values, since the two scopes restate each other', () => {
		const inTheme = declaredValues(themeBlock[0].body);
		const inLight = declaredValues(lightAttributeScope[0].body);
		const differing = Object.fromEntries(
			lightProperties()
				.filter((p) => inTheme.get(p) !== inLight.get(p))
				.map((p) => [p, { theme: inTheme.get(p), light: inLight.get(p) }])
		);
		expect(differing).toEqual({});
	});

	// Order is deliberately not compared: `@theme` interleaves the fonts, the type scale,
	// the containers, the radii and the motion tokens between the palette's own
	// declarations, so the palette subset's order there is not the light scope's.
});

describe('an explicit choice always outranks the OS preference', () => {
	it('every prefers-color-scheme rule, of either value, excludes an explicit data-theme', () => {
		// Otherwise a GM who chose Light on a dark machine gets repainted, which is the
		// state the third cookie state in #727 exists to prove does not happen. Either
		// value, because a `prefers-color-scheme: light` block that forgot this would
		// repaint the GM who chose Dark, and that is the same bug mirrored.
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
