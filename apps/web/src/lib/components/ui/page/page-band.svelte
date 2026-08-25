<script lang="ts">
	import type { Snippet } from 'svelte';
	import { PAGE_WIDTH_CLASS, type PageWidth } from './page-width';

	/**
	 * The header band every route opens with. Round seventeen V1 = B (#494) introduced
	 * it, replacing both the old #147 `PageHeader` (19 call sites) and the 17
	 * hand-rolled `<h1>`s that used to sit at a different y and a different x per route.
	 * Round twenty X1 = A (#598) gave it a `width`.
	 *
	 * Nothing outside `page.svelte` renders this. That is the whole of X1's structural
	 * answer: the band needs the width and the body owns it, so rather than passing the
	 * same prop to two components a route can then contradict itself with, the two
	 * became one `Page` that takes `width` once. `dev/ui` imports this file directly and
	 * is the exception, because a component gallery's job is to draw the band on its own.
	 *
	 * The paper still bleeds and spans the shell. `pt-4`/`md:pt-8` is the page's top
	 * gutter, carried here rather than on `main`, and `-mx-4 px-4`/`md:-mx-8 md:px-8`
	 * bleeds it back out horizontally: a sticky offset resolves against the scrollport's
	 * padding box, so while `main` had the top padding this band parked 32px below the
	 * scrollport's edge and left a strip above itself for content to scroll through
	 * (round eighteen, #527, visible on the entries table and the players page). What
	 * X1 moves is the band's *content*, onto the body's cap, inside paper that still
	 * reaches both edges - so #527's fix is untouched by construction: the bleed, the
	 * padding it re-adds and the `sticky top-0` are the same declarations they were.
	 *
	 * `eyebrow`, `title`, `description`, `actions`, `filters` and `titleAdornment` are
	 * unchanged from V1. `filters` is the optional second row a route needs for a type
	 * filter or a search field (D4's import queue, the entries table) - the reason V1's
	 * option C ("the title in the shell's own bar") lost is that a 48px shell bar has
	 * nowhere to grow that row, and a band that belongs to the page does.
	 * `titleAdornment` renders inline immediately after the title, same row, same
	 * baseline, for the one caller that needs it (the entry page's audit-flag badge).
	 *
	 * `headingLevel` exists for `dev/ui` and nothing else (#728). The band is an `<h1>`
	 * on every real route, because a route has one title and this is it. Rendered inside
	 * the gallery it was a second and third `<h1>` halfway down the page, and the `<h3>`
	 * that followed each one skipped two levels, which axe reported as `heading-order`
	 * twice. The level is a prop rather than something the gallery works around, because
	 * `ProposalDiffCard` already answers this exact question the same way (#672): a
	 * component that carries a heading takes its level from the context that renders it.
	 * Every other call site leaves the default alone.
	 */
	let {
		width,
		title,
		eyebrow,
		description,
		actions,
		filters,
		titleAdornment,
		headingLevel = 1,
		height = $bindable(0)
	}: {
		width: PageWidth;
		title: string;
		eyebrow?: string;
		description?: string;
		actions?: Snippet;
		filters?: Snippet;
		titleAdornment?: Snippet;
		headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
		/** #789: the band's own rendered height, measured. `Page` republishes it as a
		 * CSS variable on the body wrapper so an element inside the body can stick
		 * against `main`'s scrollport exactly at the band's lower edge (the entries
		 * table header is the one consumer). Bound, not computed: the band wraps at
		 * every width and carries an optional filters row, so no constant is true. */
		height?: number;
	} = $props();
</script>

{#snippet content()}
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0">
			{#if eyebrow}
				<p class="mb-1 font-mono text-label tracking-wide text-muted uppercase">{eyebrow}</p>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<svelte:element this={`h${headingLevel}`} class="text-page-title font-semibold text-ink">
					{title}
				</svelte:element>
				{#if titleAdornment}
					{@render titleAdornment()}
				{/if}
			</div>
			{#if description}
				<p class="mt-2 max-w-measure text-ink-2">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 flex-wrap items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
	{#if filters}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			{@render filters()}
		</div>
	{/if}
{/snippet}

<header
	data-page-band
	bind:offsetHeight={height}
	class="sticky top-0 z-10 -mx-4 mb-6 border-b border-line bg-paper px-4 pt-4 pb-6 md:-mx-8 md:mb-8 md:px-8 md:pt-8 md:pb-8"
>
	<div class={PAGE_WIDTH_CLASS[width]}>{@render content()}</div>
</header>
