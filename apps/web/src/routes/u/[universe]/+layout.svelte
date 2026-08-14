<script lang="ts">
	/**
	 * The one main slot every route nested under a universe renders into, Entry's entry
	 * and editor routes included. Shell exposes nothing to Entry beyond this layout: no
	 * shared store, no context, just the `data` SvelteKit itself merges from ancestor
	 * loads.
	 */
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="flex min-h-screen bg-paper">
	<Sidebar
		universeSlug={data.universeSlug}
		current={data.current}
		universes={data.universes}
		recent={data.recent}
		entryCount={data.navCounts.entries}
		proposalsPending={data.navCounts.proposals}
	/>
	<main id="main" class="min-w-0 flex-1 overflow-y-auto">
		{@render children()}
	</main>
</div>
