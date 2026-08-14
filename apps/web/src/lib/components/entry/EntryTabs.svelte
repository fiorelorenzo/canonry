<script lang="ts">
	/** B1 = C: the right column that switches between Relations, Facts, Images, History. */
	import type { RelationView } from '@canonry/db';
	import RelationsPanel from './RelationsPanel.svelte';
	import FactsPanel, { type FactRow } from './FactsPanel.svelte';
	import ImagesPanel from './ImagesPanel.svelte';
	import HistoryPanel, { type RevisionRow } from './HistoryPanel.svelte';

	let {
		universeSlug,
		relations,
		facts,
		history,
		activeFactId,
		onFactToggle
	}: {
		universeSlug: string;
		relations: RelationView[];
		facts: FactRow[];
		history: RevisionRow[];
		activeFactId: string | null;
		onFactToggle: (fact: FactRow) => void;
	} = $props();

	type TabId = 'relations' | 'facts' | 'images' | 'history';

	let tabs = $derived<{ id: TabId; label: string; count: number | null }[]>([
		{ id: 'relations', label: 'Relations', count: relations.length },
		{ id: 'facts', label: 'Facts', count: facts.length },
		{ id: 'images', label: 'Images', count: null },
		{ id: 'history', label: 'History', count: history.length }
	]);

	let active = $state<TabId>('relations');
</script>

<aside
	class="w-full border-line bg-panel-2 md:w-64 md:flex-none md:border-l"
	aria-label="Entry detail"
>
	<div class="flex border-b border-line" role="tablist" aria-label="Entry detail sections">
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				aria-selected={active === tab.id}
				class="flex-1 border-b-2 px-2 py-2 text-xs font-medium"
				class:border-accent={active === tab.id}
				class:text-ink={active === tab.id}
				class:border-transparent={active !== tab.id}
				class:text-muted={active !== tab.id}
				onclick={() => (active = tab.id)}
			>
				{tab.label}{tab.count !== null ? ` (${tab.count})` : ''}
			</button>
		{/each}
	</div>

	<div class="p-4" role="tabpanel">
		{#if active === 'relations'}
			<RelationsPanel {relations} {universeSlug} />
		{:else if active === 'facts'}
			<FactsPanel {facts} {activeFactId} onToggle={onFactToggle} />
		{:else if active === 'images'}
			<ImagesPanel />
		{:else}
			<HistoryPanel revisions={history} />
		{/if}
	</div>
</aside>
