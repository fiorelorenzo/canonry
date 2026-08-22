<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Round seventeen V1 = B (#494, docs/ux/DECISIONS.md): the one header band every
	 * route inside the shell opens with, replacing both the old #147 `PageHeader` (19
	 * call sites) and the 17 hand-rolled `<h1>`s that used to sit at a different y and
	 * a different x per route. The fix is structural, not cosmetic: this component is
	 * rendered as the *first* thing a route draws, with no wrapping `mx-auto max-w-*`
	 * div around it, so its box always sits flush against `AppShell.svelte`'s `<main>`
	 * own padding - the same inset every route gets regardless of which of the three
	 * body widths (`PageBody`) that route declares below it. A page's width choice is
	 * a decision about its *body*; it was never allowed to move the band, which is
	 * the whole point ("the title cannot land anywhere else, because no page draws
	 * it" - DECISIONS.md, V1). Sticky, so a route long enough to scroll never loses
	 * the title it just gave the reader.
	 *
	 * `eyebrow`, `title`, `description` and `actions` carry over unchanged from the
	 * old component (same prop names, same call sites keep compiling). Two are new:
	 * `filters` is the optional second row a route needs for a type filter or a
	 * search field (D4's import queue, the entries table) - the reason C ("the title
	 * in the shell's own bar") lost is that a 48px shell bar has nowhere to grow that
	 * row, and a band that belongs to the page does. `titleAdornment` renders inline
	 * immediately after the `h1`, same row, same baseline - the one caller that needs
	 * it (the entry page's audit-flag badge, which has always sat beside the title
	 * rather than with the write controls) would otherwise have no way to say "this
	 * belongs to the title, not to actions" without duplicating the title row itself.
	 */
	let {
		title,
		eyebrow,
		description,
		actions,
		filters,
		titleAdornment
	}: {
		title: string;
		eyebrow?: string;
		description?: string;
		actions?: Snippet;
		filters?: Snippet;
		titleAdornment?: Snippet;
	} = $props();
</script>

<!-- Round eighteen: the band carries the page's top gutter itself (`pt-4`/`md:pt-8`) and
     bleeds it back out horizontally (`-mx-4 px-4`), rather than sitting inside a gutter
     `main` supplies. A sticky offset resolves against the scrollport's padding box, so
     while `main` had the top padding this band parked 32px below the scrollport's edge and
     left a 32px strip above itself for content to scroll through - visibly, on the entries
     table and the players page. With the gutter inside the band, `top: 0` is the
     scrollport's own edge and the band's paper covers the full width on the way past.
     `main` keeps the horizontal and bottom gutters, which is why this only bleeds the two
     sides it re-adds. -->
<header
	data-page-band
	class="sticky top-0 z-10 -mx-4 mb-6 border-b border-line bg-paper px-4 pt-4 pb-6 md:-mx-8 md:mb-8 md:px-8 md:pt-8 md:pb-8"
>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0">
			{#if eyebrow}
				<p class="mb-1 font-mono text-xs tracking-wide text-muted uppercase">{eyebrow}</p>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-2xl font-semibold text-ink">{title}</h1>
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
</header>
