<script lang="ts">
	/**
	 * Decision B5 = A: "the familiar three-pane shape the rest of the app already uses" -
	 * the tree on the left, stays reachable across every node the GM opens; the middle and
	 * right panes belong to whichever child page is open (the empty state, or a node's own
	 * editor plus its "Uses" aside).
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import WorkTree from '$lib/components/works/WorkTree.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let activeNodeId = $derived(page.params.node ?? null);
</script>

<svelte:head><title>{data.work.name} — {data.current.name}</title></svelte:head>

<div class="flex min-h-full">
	<aside
		class="w-52 flex-none overflow-y-auto border-r border-line bg-panel-2 p-2"
		aria-label="Work tree"
	>
		<a
			href={resolve(`/u/${data.current.slug}/works`)}
			class="mb-2 block truncate px-2 text-xs text-muted hover:text-ink"
		>
			&larr; {data.current.name}
		</a>
		<h1 class="mb-2 truncate px-2 text-sm font-semibold text-ink">{data.work.name}</h1>
		<WorkTree
			universeSlug={data.current.slug}
			workSlug={data.work.slug}
			tree={data.tree}
			{activeNodeId}
		/>
	</aside>
	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
