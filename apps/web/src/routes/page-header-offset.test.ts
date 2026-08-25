/**
 * Round seventeen V1 = B (#494, docs/design/DECISIONS.md): the guard against the exact
 * defect the decision measured - "the h1 of a page sits at 32, 48, 52, 60, 64, 72 or
 * 116 pixels from the top and at 288, 320, 464, 496, 520 or 608 from the left", because
 * every route drew its own title inside its own wrapper. `Page` fixes that by
 * construction rather than by convention: every route inside the shell renders it as
 * the very first thing, with nothing wrapping it - no width, no padding, no margin -
 * between it and `AppShell.svelte`'s own `<main>`. Given that, its `h1` inherits
 * exactly the same inset on every route by definition; there is no real-browser layout
 * left to assert, only whether every route actually holds up its end of that
 * construction. That is what this file checks, statically, against the route source
 * itself - the same technique `i18n/catalogue.test.ts` uses to prove a cross-cutting
 * invariant without a server. (This repo has no Playwright/browser test runner -
 * `pnpm --filter web test` is vitest only, and the band's `sticky`/full-width
 * behaviour is CSS a unit test cannot execute anyway.)
 *
 * Round twenty X1 = A (#598) merged `PageHeader` and `PageBody` into one `Page` that
 * takes `width` once, so the band's content sits on the same cap as the body and the
 * distance between a page's title and the first line of its own prose is 0 rather than
 * one of six values between 0 and 336. The guards move with it, and one is new:
 *
 * - every shell route's own markup opens with `Page`, unwrapped, so its box is never
 *   offset by a page-chosen width or a hand-rolled wrapper;
 * - "a cheaper second half of the same guard" (#494's own text): a grep for a stray
 *   page-width `max-w-` or a second `h1`, across every route this issue touched;
 * - and X1's own: no route spells `max-w-reading` or `max-w-working` at all, and no
 *   route imports the band on its own. Those two together are what make a route unable
 *   to disagree with its own band, which is the whole reason the two components
 *   collapsed rather than both taking the prop. `page-width.ts` is the one place those
 *   tokens are written, and `dev/ui` is the one file allowed to draw the band directly,
 *   because a component gallery's job is to show it on its own.
 *
 * `/p/[universe]/**` (the public players' wiki) is excluded from the first two guards on
 * purpose - `AppShell.svelte`'s own doc comment calls it "a fourth case that is not a
 * mode of this component at all", with its own light chrome and no sidebar, so its band
 * (it has one) is never claimed to land at the shell's offset. The auth pages and the
 * signed-out door have no shell at all (issue #494's own non-goals). X1's third guard
 * is repo-wide and excludes nothing, because a width spelled anywhere is a width that
 * can drift.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
	return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf-8');
}

/** Strips everything that is not markup a route actually paints: the `<script>`
 * block, `<svelte:head>`, and HTML comments - what is left starts with whatever the
 * component renders first. */
function markupOnly(source: string): string {
	return source
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<svelte:head[^>]*>[\s\S]*?<\/svelte:head[^>]*>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.trim();
}

/** Two tags carry no layout box of their own for this purpose: `svelte:element`
 * picking between `main`/`div` for AppShell's landmark (#474's pattern, `DocPage.svelte`
 * and the two `dev/*` galleries) and `Tooltip.Provider` (`dev/ui`'s outermost element,
 * a context provider with no markup of its own). Unwrapping through those in order is
 * what "the first thing this route draws" means for a route that needs one. */
const TRANSPARENT_WRAPPERS: Record<string, true> = {
	'svelte:element': true,
	'Tooltip.Provider': true
};

/** The first tag a browser would actually paint, unwrapping past anything in
 * `TRANSPARENT_WRAPPERS`. `null` if the markup does not open on a plain tag at all
 * (an `{#if}`/`{#each}` block, most commonly - callers that can start there special-case
 * it themselves rather than this helper guessing which branch is the one that matters). */
function firstRenderedTag(markup: string): string | null {
	let rest = markup;
	for (;;) {
		const match = rest.match(/^<([A-Za-z][\w.:-]*)/);
		if (!match) return null;
		const tag = match[1];
		if (!TRANSPARENT_WRAPPERS[tag]) return tag;
		const openEnd = rest.indexOf('>');
		if (openEnd === -1) return null;
		rest = rest.slice(openEnd + 1).trim();
	}
}

/** Every route file inside the shell whose own markup is expected to open directly on
 * the band. Layouts that only ever pass `{@render children()}` through unchanged
 * (`w/[universe]/+layout.svelte`, `works/[work]/+layout.svelte`, `table/+layout.svelte`)
 * are not listed - the page underneath is where the band actually renders, and that
 * page is listed instead. `settings/+layout.svelte` *is* listed: it is the one place
 * V1 hoists the band above a shared rail (see that file's own doc comment on why). */
const SHELL_ROUTES = [
	'./w/[universe]/+page.svelte',
	'./w/[universe]/entries/+page.svelte',
	'./w/[universe]/e/[slug]/+page.svelte',
	'./w/[universe]/e/[slug]/edit/+page.svelte',
	'./w/[universe]/proposals/+page.svelte',
	'./w/[universe]/proposals/[plan]/+page.svelte',
	'./w/[universe]/review/[proposal]/+page.svelte',
	'./w/[universe]/import/+page.svelte',
	'./w/[universe]/import/[job]/review/+page.svelte',
	'./w/[universe]/players/+page.svelte',
	'./w/[universe]/ask/+page.svelte',
	'./w/[universe]/ask/[conversationId]/+page.svelte',
	'./w/[universe]/settings/+page.svelte',
	'./w/[universe]/relations/+page.svelte',
	'./w/[universe]/works/+page.svelte',
	'./w/[universe]/works/[work]/+page.svelte',
	'./w/[universe]/works/[work]/[node]/+page.svelte',
	'./w/[universe]/table/+page.svelte',
	'./admin/indexing/+page.svelte',
	'./admin/metrics/+page.svelte',
	'./admin/models/+page.svelte',
	'./admin/pricing/+page.svelte',
	'./onboarding/+page.svelte',
	'./onboarding/import/+page.svelte',
	'./onboarding/import/[job]/+page.svelte',
	'./settings/+layout.svelte',
	'./dev/ai-marking/+page.svelte',
	'./dev/ui/+page.svelte'
] as const;

describe('every shell route opens on the same band (V1 = B #494, X1 = A #598)', () => {
	for (const route of SHELL_ROUTES) {
		it(`${route.replace(/^\.\.?\//, '')} renders Page first, unwrapped`, () => {
			const tag = firstRenderedTag(markupOnly(read(route)));
			expect(tag).toBe('Page');
		});
	}

	// The root route draws two entirely different pages behind one `{#if data.user}` -
	// I1/I3's door (signed out, no shell at all, explicitly out of scope) versus the
	// universe list (signed in, inside the shell). Only the second branch is this
	// issue's to hold to the band.
	it('the root route draws Page first in its signed-in branch', () => {
		const source = read('./+page.svelte');
		const signedInBranch = source.slice(source.indexOf('{:else}') + '{:else}'.length);
		const tag = firstRenderedTag(markupOnly(signedInBranch));
		expect(tag).toBe('Page');
	});

	// `/w/[universe]/ask` and `/w/[universe]/ask/[conversationId]` are both covered by
	// the loop above now - issue #531 (W3 = B) deleted `AskConversation.svelte` and gave
	// each route its own band directly, since neither shares markup with the other any
	// more (the old shared composer is the dock's now, `QuickAsk.svelte`).

	// `/docs`, `/docs/import`, `/docs/import/[source]`, `/docs/languages` and
	// `/privacy` all delegate their chrome to this one component - checked once here
	// rather than five times by proxy.
	it('DocPage.svelte renders Page first, unwrapped', () => {
		const tag = firstRenderedTag(markupOnly(read('../lib/components/docs/DocPage.svelte')));
		expect(tag).toBe('Page');
	});

	// `+error.svelte` at the root and under `/w/[universe]` both render nothing but
	// `<ErrorPage />` - checked once here for the same reason.
	it('ErrorPage.svelte renders Page first, unwrapped', () => {
		const tag = firstRenderedTag(markupOnly(read('../lib/components/shell/ErrorPage.svelte')));
		expect(tag).toBe('Page');
	});
});

/** "A cheaper second half of the same guard" (#494's own text): every route file this
 * issue touched, minus the ones above whose whole markup is exactly one `<Page .../>`
 * line with no room for a second heading, scanned for a stray page-container width or a
 * competing `h1`. `mx-auto` paired with a `max-w-` that is not one of the three named
 * tokens is what a re-introduced arbitrary page width actually looks like in this
 * codebase (`grep`'s own findings, `DECISIONS.md`'s V1 section) - a bare
 * `max-w-sm`/`max-w-xs`/`max-w-2xl` with no `mx-auto` is a form field, a table cell or
 * a conditional side-panel's own width, never a page container, and is left alone. */
const GUARDED_FILES = [
	...SHELL_ROUTES,
	'./w/[universe]/works/[work]/+layout.svelte',
	'../lib/components/docs/DocPage.svelte',
	'../lib/components/shell/ErrorPage.svelte'
] as const;

const STRAY_PAGE_WIDTH =
	/mx-auto[^"]*max-w-(?!reading\b|working\b|measure\b)[\w-]+|max-w-(?!reading\b|working\b|measure\b)[\w-]+[^"]*mx-auto/;

describe('no route drifts back to a hand-picked page width or a second h1 (#494)', () => {
	for (const file of GUARDED_FILES) {
		it(`${file.replace(/^\.\.?\//, '')} has no stray page-width max-w-`, () => {
			expect(read(file)).not.toMatch(STRAY_PAGE_WIDTH);
		});
	}

	for (const file of GUARDED_FILES) {
		it(`${file.replace(/^\.\.?\//, '')} renders at most one h1`, () => {
			const h1Count = (markupOnly(read(file)).match(/<h1[\s>]/g) ?? []).length;
			expect(h1Count).toBeLessThanOrEqual(1);
		});
	}

	// The one file in this set that legitimately renders zero h1 of its own - its
	// job is the demoted work-name label beside the tree, never the page's title
	// (that is `[work]/+page.svelte` and `[node]/+page.svelte`, both already covered
	// above with their own PageHeader).
	it('works/[work]/+layout.svelte carries no h1 of its own', () => {
		expect(markupOnly(read('./w/[universe]/works/[work]/+layout.svelte'))).not.toMatch(/<h1[\s>]/);
	});
});

/** X1 = A (#598)'s own guard, and the reason `PageHeader` and `PageBody` collapsed into
 * one component rather than both taking a `width` prop. Two components each taking the
 * width let a route give its band one value and its body another, and nothing but a
 * reviewer would catch it. One component cannot, and these two assertions are what keep
 * it that way: the two container tokens are spelled in exactly one file, and the band is
 * imported in exactly one place plus the gallery that exists to draw it.
 *
 * Repo-wide on purpose, and by directory walk rather than by a list, because a list is
 * the thing a new route is added without. */
describe('the width is declared once, and only Page declares it (X1 = A, #598)', () => {
	const SRC = fileURLToPath(new URL('..', import.meta.url));
	const WIDTH_TOKEN = /max-w-(?:reading|working)\b/;
	const BAND_IMPORT = /page\/page-band\.svelte/;
	// This file spells both tokens, in the regex above and in prose, because it is the
	// guard. Nothing else may.
	const SELF = 'routes/page-header-offset.test.ts';

	/** Every `.svelte`/`.ts` file under `apps/web/src`, relative to it. */
	function sources(dir = '', out: string[] = []): string[] {
		for (const entry of readdirSync(`${SRC}${dir}`, { withFileTypes: true })) {
			const rel = `${dir}${entry.name}`;
			if (entry.isDirectory()) sources(`${rel}/`, out);
			else if (/\.(svelte|ts)$/.test(entry.name)) out.push(rel);
		}
		return out;
	}

	/** Comments out, so this guard is about what a component renders rather than about
	 * what a doc comment is allowed to name. Two of these files explain, in prose, the
	 * width token they used to apply themselves before X1, and saying so is the point of
	 * the comment. Only line comments that open their own line are stripped, so a `//`
	 * inside a URL survives and cannot swallow the rest of the line with it. */
	function withoutComments(source: string): string {
		return source
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^[ \t]*(?:\/\/|\*).*$/gm, '');
	}

	const ALL = sources();
	const code = (file: string) => withoutComments(readFileSync(`${SRC}${file}`, 'utf-8'));

	it('finds the app it is walking', () => {
		// A broken walk would make both assertions below pass by finding nothing.
		expect(ALL.length).toBeGreaterThan(200);
		expect(ALL).toContain('lib/components/ui/page/page-width.ts');
		expect(ALL).toContain(SELF);
	});

	it('spells the two container widths in page-width.ts and nowhere else', () => {
		const spelling = ALL.filter((f) => f !== SELF && WIDTH_TOKEN.test(code(f)));
		expect(spelling).toEqual(['lib/components/ui/page/page-width.ts']);
	});

	it('imports the band only in page.svelte and the component gallery', () => {
		const importing = ALL.filter(
			(f) => !f.startsWith('lib/components/ui/page/') && BAND_IMPORT.test(code(f))
		);
		expect(importing).toEqual(['routes/dev/ui/+page.svelte']);
	});
});
