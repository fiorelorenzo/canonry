<script lang="ts">
	/**
	 * Decision B5 = A's left pane: the whole tree, one line per node, indented by depth.
	 * Flat rather than recursive on purpose - `workNodeTree` already hands back a
	 * pre-order list, so rendering it is one `{#each}`, not a component calling itself.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import type { WorkNodeKind } from '@canonry/db/schema';

	export interface TreeItem {
		id: string;
		parentId: string | null;
		kind: WorkNodeKind;
		title: string;
		position: number;
		depth: number;
	}

	let {
		universeSlug,
		workSlug,
		tree,
		activeNodeId,
		locale
	}: {
		universeSlug: string;
		workSlug: string;
		tree: TreeItem[];
		activeNodeId: string | null;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));
</script>

<nav class="flex flex-col gap-0.5" aria-label={t.works.tree.ariaLabel}>
	{#each tree as node (node.id)}
		{@const active = node.id === activeNodeId}
		<a
			href={resolve(`/w/${universeSlug}/works/${workSlug}/${node.id}`)}
			style="padding-left: {node.depth * 12 + 8}px"
			class="flex items-center gap-1.5 rounded-md py-1 pr-2 text-body"
			class:bg-panel={active}
			class:font-semibold={active}
			class:text-ink={active}
			class:text-ink-2={!active}
			class:hover:bg-panel-2={!active}
		>
			<span class="shrink-0 font-mono text-label text-muted uppercase"
				>{t.works.kinds[node.kind][0]}</span
			>
			<span class="truncate">{node.title}</span>
		</a>
	{/each}
</nav>
