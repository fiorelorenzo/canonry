/**
 * G1 = B (docs/design/DECISIONS.md): dark is a whole-app preference with three values,
 * and the third one, "Match system", resolves to **no `data-theme` attribute at all**
 * (`lib/theme.ts`, deliberately, so the setting keeps tracking a later OS change). So
 * dark arrives by two different selector conditions, and CSS has no single rule for
 * both:
 *
 * - an explicit choice, `[data-theme='dark']` on `<html>`, written server side in
 *   `hooks.server.ts` so there is no flash;
 * - no choice at all, `@media (prefers-color-scheme: dark)` scoped to
 *   `html:not([data-theme])`.
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
 * 3. **Every `prefers-color-scheme: dark` rule excludes an explicit attribute.** A media
 *    rule that forgets `:not([data-theme])` repaints a GM who explicitly chose **light**
 *    on a dark machine, which is the leak the third cookie state exists to catch. It is
 *    also the reason the media branch cannot simply be widened to "dark OS".
 *
 * ## What this cannot see
 *
 * It reads one file's text, so it holds the palette scopes of `layout.css` in step and
 * nothing else. It cannot tell you that a `dark:` utility renders, that the cascade
 * resolves the way the selector suggests, or that the result clears a contrast floor:
 * #727 verified all three in a browser across three cookie states, and this is the part
 * of that which is cheap enough to run on every push. It also says nothing about
 * `app.html`'s two `theme-color` metas or `static/favicon.svg`, both of which key off
 * the media query **alone** and so ignore an explicit choice: that is the same class of
 * defect in the other direction, filed separately rather than asserted here, because
 * neither is CSS this file can read and a `<meta>` cannot read the attribute at all.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const CSS = readFileSync(`${SRC}routes/layout.css`, 'utf-8');

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

const MEDIA_DARK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/;

const variant = blocks(CSS, /@custom-variant\s+dark\s*\{/);
const mediaDarkBlocks = blocks(CSS, MEDIA_DARK);
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
	it('found the file and both dark mechanisms in it', () => {
		// A broken read or a broken walk would make every assertion below pass on nothing.
		expect(CSS.length).toBeGreaterThan(10_000);
		expect(variant).toHaveLength(1);
		expect(attributeScope).toHaveLength(1);
		expect(tokenMediaScope).toHaveLength(1);
		expect(lightAttributeScope).toHaveLength(1);
		// Two of them now: the variant's own branch, and the token block's.
		expect(mediaDarkBlocks).toHaveLength(2);
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

describe('an explicit choice always outranks the OS preference', () => {
	it('every prefers-color-scheme: dark rule excludes an explicit data-theme', () => {
		// Otherwise a GM who chose Light on a dark machine gets repainted, which is the
		// state the third cookie state in #727 exists to prove does not happen.
		for (const block of mediaDarkBlocks) {
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
