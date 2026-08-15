<script lang="ts">
	/**
	 * E1 = B: table mode is a mode, not a drawer - this is the frame every page under
	 * /table renders inside. It does not reskin the rest of the app (that would mean
	 * touching the root shell layout, outside these owned paths); within this subtree it
	 * commits fully: taller rows, the dock's thumb-sized targets, room at the bottom for
	 * #81's phone tab bar. G1 = B means it never forces dark - whatever the account's
	 * appearance preference already is, this inherits it, same tokens as the rest of the
	 * product (routes/layout.css).
	 */
	import type { Snippet } from 'svelte';
	import { messages } from '$lib/i18n';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const t = $derived(messages(data.locale).table);
</script>

<svelte:head>
	<title>{t.title} &middot; {data.universeName} &middot; Canonry</title>
</svelte:head>

<div class="min-h-screen bg-paper pb-16 text-[15px] leading-relaxed md:pb-0">
	{@render children()}
</div>

<style>
	/* #81, E4's own guardrail-4 framing: on 314px of usable width, the fixed 256px
	 * (`w-64`) shell sidebar from `u/[universe]/+layout.svelte` (outside these owned
	 * paths - that layout renders it unconditionally, with no responsive breakpoint of
	 * its own yet) leaves this subtree's content nowhere to go but overflow. `:global()`
	 * targets it by its stable `aria-label` rather than reaching into that file, and
	 * because Svelte only loads this stylesheet for routes under this layout, the rule
	 * never touches the sidebar anywhere outside /table - every other route's mobile nav
	 * (not yet built, tracked separately) is untouched. `md` matches the exact breakpoint
	 * `PhoneTabBar.svelte` already uses (`md:hidden`), so the swap from sidebar to bottom
	 * tabs happens at one consistent width instead of two independently-chosen ones. */
	@media (max-width: 767px) {
		:global(aside[aria-label='Universe navigation']) {
			display: none;
		}
	}
</style>
