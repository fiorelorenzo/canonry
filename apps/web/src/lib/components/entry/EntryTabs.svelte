<script lang="ts">
	/**
	 * B1 = C: the right column that switches between Relations, Facts, Images, History.
	 * C9 = B (#55): Audit is a fifth section here, reading the same flag list the entry
	 * title's badge counts (`AuditFlagBadge`) - "an aside section" is this one, not a
	 * second copy of the data. `active` is bindable so that badge can switch straight to
	 * this tab from the title row, the same lift-to-parent shape `activeFactId` already
	 * uses between this component and `EntryProseWithSecrets`.
	 */
	import type { RelationView } from '@canonry/db';
	import RelationsPanel from './RelationsPanel.svelte';
	import FactsPanel, { type FactRow } from './FactsPanel.svelte';
	import EntryMediaPanel from '../media/EntryMediaPanel.svelte';
	import HistoryPanel, { type RevisionRow } from './HistoryPanel.svelte';
	import AuditFlagsPanel, { type AuditFlagView } from '../audit/AuditFlagsPanel.svelte';

	type ModelSummary = { provider: string; modelId: string } | null;
	interface MediaAssetView {
		id: string;
		mimeType: string;
		generated: boolean;
		publishedToPlayers: boolean;
		credits: number;
		createdAt: string | Date;
	}
	interface MediaTabData {
		entitySlug: string;
		entityName: string;
		entityType: string;
		aiEnabled: boolean;
		canWrite: boolean;
		assets: MediaAssetView[];
		styleModifier: string | null;
		entityImagePromptModifier: string | null;
		portraitPrice: number;
		variantsPrice: number;
		portraitModel: ModelSummary;
		variantsModel: ModelSummary;
	}

	let {
		universeSlug,
		relations,
		facts,
		history,
		activeFactId,
		onFactToggle,
		media,
		audit,
		active = $bindable('relations')
	}: {
		universeSlug: string;
		relations: RelationView[];
		facts: FactRow[];
		history: RevisionRow[];
		activeFactId: string | null;
		onFactToggle: (fact: FactRow) => void;
		media: MediaTabData;
		audit: AuditFlagView[];
		active?: TabId;
	} = $props();

	type TabId = 'relations' | 'facts' | 'images' | 'history' | 'audit';

	let tabs = $derived<{ id: TabId; label: string; count: number | null }[]>([
		{ id: 'relations', label: 'Relations', count: relations.length },
		{ id: 'facts', label: 'Facts', count: facts.length },
		{ id: 'images', label: 'Images', count: media.assets.length },
		{ id: 'history', label: 'History', count: history.length },
		{ id: 'audit', label: 'Audit', count: audit.length }
	]);
</script>

<aside
	id="entry-detail"
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
			<EntryMediaPanel
				{universeSlug}
				entitySlug={media.entitySlug}
				entityName={media.entityName}
				entityType={media.entityType}
				aiEnabled={media.aiEnabled}
				canWrite={media.canWrite}
				assets={media.assets}
				styleModifier={media.styleModifier}
				entityImagePromptModifier={media.entityImagePromptModifier}
				portraitPrice={media.portraitPrice}
				variantsPrice={media.variantsPrice}
				portraitModel={media.portraitModel}
				variantsModel={media.variantsModel}
			/>
		{:else if active === 'audit'}
			<AuditFlagsPanel flags={audit} {universeSlug} />
		{:else}
			<HistoryPanel revisions={history} />
		{/if}
	</div>
</aside>
