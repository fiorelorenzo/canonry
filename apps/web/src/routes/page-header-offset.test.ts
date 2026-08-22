/**
 * Round seventeen V1 = B (#494, docs/ux/DECISIONS.md): the guard against the exact
 * defect the decision measured - "the h1 of a page sits at 32, 48, 52, 60, 64, 72 or
 * 116 pixels from the top and at 288, 320, 464, 496, 520 or 608 from the left", because
 * every route drew its own title inside its own wrapper. `PageHeader` fixes that by
 * construction rather than by convention: every route inside the shell renders it as
 * the very first thing, with nothing wrapping it - no width, no padding, no margin -
 * between it and `AppShell.svelte`'s own `<main>`. Given that, its `h1` inherits
 * exactly the same inset on every route by definition; there is no real-browser layout
 * left to assert, only whether every route actually holds up its end of that
 * construction. That is what this file checks, statically, against the route source
 * itself - the same technique `i18n/catalogue.test.ts` uses to prove a cross-cutting
 * invariant without a server. (This repo has no Playwright/browser test runner -
 * `pnpm --filter web test` is vitest only, and `PageHeader`'s `sticky`/full-width
 * behaviour is CSS a unit test cannot execute anyway.)
 *
 * Two guards, per the issue's own text:
 * - the primary one: every shell route's own markup opens with `PageHeader`,
 *   unwrapped, so its box is never offset by a page-chosen width or a hand-rolled
 *   wrapper;
 * - "a cheaper second half of the same guard": a grep for a stray page-width `max-w-`
 *   or a second `h1`, across every route this issue touched.
 *
 * `/p/[universe]/**` (the public players' wiki) is excluded from both guards on
 * purpose - `AppShell.svelte`'s own doc comment calls it "a fourth case that is not a
 * mode of this component at all", with its own light chrome and no sidebar, so its
 * `PageHeader` (it has one) is never claimed to land at the shell's offset. The auth
 * pages and the signed-out door have no shell at all (issue #494's own non-goals).
 */
import { readFileSync } from 'node:fs';
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
	'./w/[universe]/settings/relations/+page.svelte',
	'./w/[universe]/works/+page.svelte',
	'./w/[universe]/works/[work]/+page.svelte',
	'./w/[universe]/works/[work]/[node]/+page.svelte',
	'./w/[universe]/table/+page.svelte',
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

describe('every shell route opens on the same band (V1 = B, #494)', () => {
	for (const route of SHELL_ROUTES) {
		it(`${route.replace(/^\.\.?\//, '')} renders PageHeader first, unwrapped`, () => {
			const tag = firstRenderedTag(markupOnly(read(route)));
			expect(tag).toBe('PageHeader');
		});
	}

	// The root route draws two entirely different pages behind one `{#if data.user}` -
	// I1/I3's door (signed out, no shell at all, explicitly out of scope) versus the
	// universe list (signed in, inside the shell). Only the second branch is this
	// issue's to hold to the band.
	it('the root route draws PageHeader first in its signed-in branch', () => {
		const source = read('./+page.svelte');
		const signedInBranch = source.slice(source.indexOf('{:else}') + '{:else}'.length);
		const tag = firstRenderedTag(markupOnly(signedInBranch));
		expect(tag).toBe('PageHeader');
	});

	// `/w/[universe]/ask` and `/w/[universe]/ask/[conversationId]` are both covered by
	// the loop above now - issue #531 (W3 = B) deleted `AskConversation.svelte` and gave
	// each route its own `PageHeader` directly, since neither shares markup with the
	// other any more (the old shared composer is the dock's now, `QuickAsk.svelte`).

	// `/docs`, `/docs/import`, `/docs/import/[source]`, `/docs/languages` and
	// `/privacy` all delegate their chrome to this one component - checked once here
	// rather than five times by proxy.
	it('DocPage.svelte renders PageHeader first, unwrapped', () => {
		const tag = firstRenderedTag(markupOnly(read('../lib/components/docs/DocPage.svelte')));
		expect(tag).toBe('PageHeader');
	});

	// `+error.svelte` at the root and under `/w/[universe]` both render nothing but
	// `<ErrorPage />` - checked once here for the same reason.
	it('ErrorPage.svelte renders PageHeader first, unwrapped', () => {
		const tag = firstRenderedTag(markupOnly(read('../lib/components/shell/ErrorPage.svelte')));
		expect(tag).toBe('PageHeader');
	});
});

/** "A cheaper second half of the same guard" (#494's own text): every route file this
 * issue touched, minus the ones above whose whole markup is exactly one `<PageHeader
 * .../>` line with no room for a second heading, scanned for a stray page-container
 * width or a competing `h1`. `mx-auto` paired with a `max-w-` that is not one of the
 * three named tokens is what a re-introduced arbitrary page width actually looks like
 * in this codebase (`grep`'s own findings, `DECISIONS.md`'s V1 section) - a bare
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
