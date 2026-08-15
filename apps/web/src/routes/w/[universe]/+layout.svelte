<script lang="ts">
	/**
	 * Issue #141 (I3 = B): the sidebar this used to mount moved to the root layout,
	 * which reads this route's own `current`/`universeSlug`/`recent`/`navCounts` back
	 * out of `page.data` (SvelteKit merges every ancestor layout's load data down the
	 * tree) to render AppShell in universe mode. This file keeps the `+layout.server.ts`
	 * load beside it - every route nested under a universe, Entry's entry and editor
	 * routes included, still needs that data resolved and merged - but contributes no
	 * markup of its own any more, so there is exactly one frame per route instead of
	 * one nested inside another.
	 */
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
