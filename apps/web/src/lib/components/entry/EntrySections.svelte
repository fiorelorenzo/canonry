<script module lang="ts">
	/** B4 = B, facts on demand: Facts closed. The other three closed with it, so the
	 * column opens at the length of one section rather than five, and Relations open
	 * because B3 = A put relations in the margin as the thing a GM reads beside the
	 * prose. Exported because the entry page owns the state both mounts share (#148),
	 * so the defaults have to be readable from there without being retyped. */
	export const DEFAULT_SECTIONS_OPEN = {
		relations: true,
		facts: false,
		images: false,
		history: false,
		audit: false
	};
</script>

<script lang="ts">
	/**
	 * B1 = C's right column, as O2 (#284) rebuilt it: five collapsible sections stacked,
	 * each carrying its own count in its header, instead of the five-label tab strip this
	 * component used to draw.
	 *
	 * The strip was 256px wide with five `flex-1` labels, no `min-w-0` and no overflow
	 * handling, so the row was wider than its own column and the last label hung off the
	 * edge: invisible in English, where "Audit" is short, and total in Italian, where
	 * "Verifica" never appeared at all. The fix is not `truncate`, which would leave the
	 * layout depending on how long a translated word happens to be and would clip again
	 * under the next locale or font stack. It is that there is no strip left to clip.
	 *
	 * Native `<details>`/`<summary>`, not a JS disclosure: the sections open and close with
	 * no script at all, and each one carries a real id, so a section is linkable in a way a
	 * tab never was. Those ids are prefixed with the mount's own `id` because #148 mounts
	 * this component twice below `md` (see `id` below), and two elements called `#facts` on
	 * one page is a worse bug than the one being fixed here.
	 *
	 * B4 is what sets the defaults: Relations open, Facts closed, "on demand" being the
	 * decision for facts specifically. C9 = B (#55) keeps Audit as the fifth section, still
	 * reading the same flag list the title's `AuditFlagBadge` counts rather than a second
	 * copy of the data; `open` is bindable so that badge can open this section from the
	 * title row, the same lift-to-parent shape `activeFactId` already uses between this
	 * component and `EntryProseWithSecrets`, and so both mounts agree on what is open.
	 *
	 * B1 = C itself is not reopened. The page is still a document plus a switching right
	 * column: what changed is the switch, and the five panels keep exactly what they held
	 * before.
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
	interface MediaSectionData {
		entitySlug: string;
		entityName: string;
		entityType: string;
		aiEnabled: boolean;
		canWrite: boolean;
		assets: MediaAssetView[];
		coverAssetId: string | null;
		styleModifier: string | null;
		entityImagePromptModifier: string | null;
		portraitPrice: number;
		variantsPrice: number;
		portraitModel: ModelSummary;
		variantsModel: ModelSummary;
	}

	export type SectionId = 'relations' | 'facts' | 'images' | 'history' | 'audit';
	export type SectionOpenState = Record<SectionId, boolean>;

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
		open = $bindable({ ...DEFAULT_SECTIONS_OPEN })
	}: {
		/** Issue #148 (I10 = B): this component mounts twice on the entry page below
		 * `md` (inline, hidden, plus a second copy inside the mobile details sheet)
		 * - a hardcoded id would duplicate an `id` attribute across the DOM, so the
		 * caller gives the second mount its own. Every section id below is derived
		 * from it for the same reason. */
		id?: string;
		universeSlug: string;
		relations: RelationView[];
		facts: FactRow[];
		history: RevisionRow[];
		activeFactId: string | null;
		onFactToggle: (fact: FactRow) => void;
		media: MediaSectionData;
		audit: AuditFlagView[];
		locale: Locale;
		open?: SectionOpenState;
	} = $props();
	let t = $derived(messages(locale));

	let sections = $derived<{ id: SectionId; label: string; count: number }[]>([
		{ id: 'relations', label: t.entry.sections.relations, count: relations.length },
		{ id: 'facts', label: t.entry.sections.facts, count: facts.length },
		{ id: 'images', label: t.entry.sections.images, count: media.assets.length },
		{ id: 'history', label: t.entry.sections.history, count: history.length },
		{ id: 'audit', label: t.entry.sections.audit, count: audit.length }
	]);
</script>

<!-- Sticky with its own scroll, per the decision: the column is long now that five
	sections can all be open at once, and a document longer than the aside should not drag
	the aside off the top of the screen. `md:` only - inside #148's bottom sheet the sheet
	itself is the scroller.

	Q2 (round twelve): `md:h-full` is load-bearing, not decorative. The caller wraps this
	component in a plain block div for visibility toggling (`hidden md:block` in
	+page.svelte), and that wrapper is what actually receives the row's stretched height
	via the default flex `align-items: stretch` - this element does not inherit it just by
	sitting inside a taller box, it still sizes itself by its own content unless told to
	fill. `md:max-h-[calc(100vh-4rem)]` then re-caps that at the viewport for a page whose
	document runs past it, and `md:overflow-y-auto` is what makes the cap a scroll rather
	than a clip. -->
<aside
	{id}
	class="w-full border-line bg-panel-2 md:sticky md:top-0 md:h-full md:max-h-[calc(100vh-4rem)] md:w-64 md:flex-none md:overflow-y-auto md:border-l"
	aria-label={t.entry.sections.ariaLabel}
>
	{#each sections as section (section.id)}
		<details
			id={`${id}-${section.id}`}
			class="border-b border-line last:border-b-0"
			bind:open={open[section.id]}
		>
			<summary
				class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-medium text-ink hover:bg-panel focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
			>
				<span
					class="text-[10px] text-muted transition-transform"
					class:rotate-90={open[section.id]}
					aria-hidden="true">&#9656;</span
				>
				<span>{section.label}</span>
				<span class="ml-auto font-mono text-[11px] text-muted">{section.count}</span>
			</summary>
			<div class="px-4 pb-4">
				{#if section.id === 'relations'}
					<RelationsPanel {relations} {universeSlug} {locale} />
				{:else if section.id === 'facts'}
					<FactsPanel {facts} {activeFactId} onToggle={onFactToggle} {locale} />
				{:else if section.id === 'images'}
					<EntryMediaPanel
						{universeSlug}
						entitySlug={media.entitySlug}
						entityName={media.entityName}
						entityType={media.entityType}
						aiEnabled={media.aiEnabled}
						canWrite={media.canWrite}
						assets={media.assets}
						coverAssetId={media.coverAssetId}
						styleModifier={media.styleModifier}
						entityImagePromptModifier={media.entityImagePromptModifier}
						portraitPrice={media.portraitPrice}
						variantsPrice={media.variantsPrice}
						portraitModel={media.portraitModel}
						variantsModel={media.variantsModel}
						{locale}
					/>
				{:else if section.id === 'history'}
					<HistoryPanel revisions={history} {locale} />
				{:else}
					<AuditFlagsPanel flags={audit} {universeSlug} {locale} />
				{/if}
			</div>
		</details>
	{/each}
</aside>
