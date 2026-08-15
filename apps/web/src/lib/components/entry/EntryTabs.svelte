<script lang="ts">
	/**
	 * B1 = C: the right column that switches between Relations, Facts, Images, History.
	 * C9 = B (#55): Audit is a fifth section here, reading the same flag list the entry
	 * title's badge counts (`AuditFlagBadge`) - "an aside section" is this one, not a
	 * second copy of the data. `active` is bindable so that badge can switch straight to
	 * this tab from the title row, the same lift-to-parent shape `activeFactId` already
	 * uses between this component and `EntryProseWithSecrets`.
	 */
	import { messages, type Locale } from '$lib/i18n';
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
		id = 'entry-detail',
		universeSlug,
		relations,
		facts,
		history,
		activeFactId,
		onFactToggle,
		media,
		audit,
		locale,
		active = $bindable('relations')
	}: {
		/** Issue #148 (I10 = B): this component mounts twice on the entry page below
		 * `md` (inline, hidden, plus a second copy inside the mobile details sheet)
		 * - a hardcoded id would duplicate an `id` attribute across the DOM, so the
		 * caller gives the second mount its own. */
		id?: string;
		universeSlug: string;
		relations: RelationView[];
		facts: FactRow[];
		history: RevisionRow[];
		activeFactId: string | null;
		onFactToggle: (fact: FactRow) => void;
		media: MediaTabData;
		audit: AuditFlagView[];
		locale: Locale;
		active?: TabId;
	} = $props();
	let t = $derived(messages(locale));

	type TabId = 'relations' | 'facts' | 'images' | 'history' | 'audit';

	let tabs = $derived<{ id: TabId; label: string; count: number | null }[]>([
		{ id: 'relations', label: t.entry.tabs.relations, count: relations.length },
		{ id: 'facts', label: t.entry.tabs.facts, count: facts.length },
		{ id: 'images', label: t.entry.tabs.images, count: media.assets.length },
		{ id: 'history', label: t.entry.tabs.history, count: history.length },
		{ id: 'audit', label: t.entry.tabs.audit, count: audit.length }
	]);
</script>

<aside
	{id}
	class="w-full border-line bg-panel-2 md:w-64 md:flex-none md:border-l"
	aria-label={t.entry.tabs.ariaLabel}
>
	<!-- #147: this stays a raw tab strip - the active tab reads through a bottom-border
		indicator (border-accent vs border-transparent), which none of Button's variants
		draw, so forcing it onto Button would lose the one thing that shows which tab is
		open. -->
	<div class="flex border-b border-line" role="tablist" aria-label={t.entry.tabs.sectionsAriaLabel}>
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
			<RelationsPanel {relations} {universeSlug} {locale} />
		{:else if active === 'facts'}
			<FactsPanel {facts} {activeFactId} onToggle={onFactToggle} {locale} />
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
				{locale}
			/>
		{:else if active === 'audit'}
			<AuditFlagsPanel flags={audit} {universeSlug} {locale} />
		{:else}
			<HistoryPanel revisions={history} {locale} />
		{/if}
	</div>
</aside>
