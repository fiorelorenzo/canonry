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
