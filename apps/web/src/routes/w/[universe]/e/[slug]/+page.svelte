<script lang="ts">
	/**
	 * The entry read view, B1 = C: a document plus a right column that switches between
	 * Relations, Facts, Images, History and Audit (C9 = B, #55). O2 (#284) changed what the
	 * switch is, not the shape: the column is five collapsible sections now
	 * (`EntrySections`), and a cover band sits above the title when the entry has one.
	 *
	 * Issue #148 (I10 = B): below `md` that right column can't sit beside the
	 * document, so it becomes reachable rather than cropped - `EntrySections` renders
	 * a second time inside a bottom `sheet`, opened by a trigger under the prose,
	 * instead of always stacking the whole panel under the article. Both copies share
	 * `sectionsOpen`, so opening a section in one is reflected in whichever the viewport
	 * shows next, and the sheet carries the same five sections with the same labels.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import EntryProseWithSecrets from '$lib/components/players/EntryProseWithSecrets.svelte';
	import EntrySections, {
		DEFAULT_SECTIONS_OPEN,
		type SectionOpenState
	} from '$lib/components/entry/EntrySections.svelte';
	import EntryCover from '$lib/components/media/EntryCover.svelte';
	import CompleteEntryControl from '$lib/components/entry/CompleteEntryControl.svelte';
	import LanguageControl from '$lib/components/entry/LanguageControl.svelte';
	import AuditFlagBadge from '$lib/components/audit/AuditFlagBadge.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import type { FactRow } from '$lib/components/entry/FactsPanel.svelte';
	import type { FactSpan } from '$lib/markdown';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let t = $derived(messages(data.locale));

	let activeFact = $state<FactRow | null>(null);
	let sectionsOpen = $state<SectionOpenState>({ ...DEFAULT_SECTIONS_OPEN });
	let detailsOpen = $state(false);

	function toggleFact(fact: FactRow): void {
		activeFact = activeFact?.id === fact.id ? null : fact;
	}

	let highlightSpan = $derived<FactSpan | null>(
		activeFact ? { start: activeFact.spanStart, end: activeFact.spanEnd } : null
	);

	// #148: computed once so both the inline (`md`+) and the mobile-sheet copy of
	// `EntrySections` below pass the identical object rather than two literals drifting.
	let mediaSectionData = $derived({
		entitySlug: data.entity.slug,
		entityName: data.entity.name,
		entityType: data.entity.type,
		aiEnabled: data.universe.aiEnabled,
		canWrite: data.media.canWrite,
		assets: data.media.assets,
		coverAssetId: data.entity.coverAssetId,
		styleModifier: data.media.style.modifier,
		entityImagePromptModifier: data.entity.imagePromptModifier,
		portraitPrice: data.media.generate.portrait.price,
		variantsPrice: data.media.generate.variants.price,
		portraitModel: data.media.generate.portrait.model,
		variantsModel: data.media.generate.variants.model
	});

	// O2 (#284): no band and no dashed placeholder when there is no cover, so this is the
	// whole condition - `EntryCover` has no absent state to render. The band reads the GM's
	// own media route, which sits behind universe membership; `/p/<slug>` builds its own URL
	// from its own published-only resolution (guardrail 6).
	let coverUrl = $derived(
		data.entity.coverAssetId
			? resolve(`/w/${data.universe.slug}/e/${data.entity.slug}/media/${data.entity.coverAssetId}`)
			: null
	);

	// C9 = B: the title badge is a pointer into the aside's own Audit section, not a second
	// copy of the flag list - clicking it opens that section and, below `md` where the
	// inline copy is hidden (#148), opens the sheet holding the other one instead.
	function openAuditSection(): void {
		sectionsOpen.audit = true;
		if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
			document
				.getElementById('entry-detail-audit')
				?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} else {
			detailsOpen = true;
		}
	}
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<div class="flex flex-col md:flex-row">
	<article class="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
		<p class="mb-3 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/w/${data.universe.slug}`)}>{data.universe.name}</a>
			/ {data.entity.type} /
			<span class="text-ink-2">{data.entity.name}</span>
		</p>

		{#if coverUrl}
			<EntryCover src={coverUrl} alt={data.entity.name} entityType={data.entity.type} />
		{/if}

		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<div class="mb-1 flex flex-wrap items-center gap-2">
					<h1 class="text-3xl font-semibold text-ink">{data.entity.name}</h1>
					<AuditFlagBadge
						count={data.audit.flags.length}
						onOpen={openAuditSection}
						locale={data.locale}
					/>
				</div>
				<div class="flex flex-wrap items-center gap-2 text-sm text-muted">
					<span class="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-xs text-accent-ink">
						{data.entity.type}
					</span>
					<LanguageControl
						language={data.entity.language}
						languageSource={data.entity.languageSource}
						canWrite={data.media.canWrite}
						locale={data.locale}
					/>
					{#if data.entity.aliases.length > 0}
						<span>{t.entry.page.aliasesLabel(data.entity.aliases.join(', '))}</span>
					{/if}
				</div>
			</div>
			<div class="flex flex-none items-start gap-2">
				<CompleteEntryControl aiEnabled={data.universe.aiEnabled} locale={data.locale} />
				<a
					href={resolve(`/w/${data.universe.slug}/e/${data.entity.slug}/edit`)}
					class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				>
					{t.entry.page.editLink}
				</a>
			</div>
		</div>

		{#if data.proposals.count > 0}
			<!-- C1 = B: the marking below is the "unmistakable" cue on the sentences
			     themselves; this line is the discoverable path from noticing a marker to
			     actually reading the diff (#51), not a second marking treatment. -->
			<a
				href={data.proposals.planId
					? resolve(`/w/${data.universe.slug}/proposals/${data.proposals.planId}`)
					: resolve(`/w/${data.universe.slug}/proposals`)}
				class="mb-6 flex items-center gap-2 rounded-md border border-ai-line bg-ai-bg px-3 py-2 text-sm text-ink-2 hover:brightness-95"
			>
				<span class="font-mono text-xs font-bold text-ai">{data.proposals.count}</span>
				<span>
					{t.entry.page.pendingProposalsText(data.proposals.count)}
				</span>
			</a>
		{/if}

		<EntryProseWithSecrets
			body={data.entity.body}
			universeSlug={data.universe.slug}
			mentionTargets={data.mentionTargets}
			publicMentionTargets={data.publicMentionTargets}
			locale={data.locale}
			{highlightSpan}
			markedSentences={new Set(data.proposals.markedSentences)}
		/>
	</article>

	<div class="hidden md:block">
		<EntrySections
			universeSlug={data.universe.slug}
			relations={data.relations}
			facts={data.facts}
			history={data.history}
			audit={data.audit.flags}
			bind:open={sectionsOpen}
			activeFactId={activeFact?.id ?? null}
			onFactToggle={toggleFact}
			media={mediaSectionData}
			locale={data.locale}
		/>
	</div>

	<div class="border-t border-line px-4 py-3 md:hidden">
		<Sheet.Root bind:open={detailsOpen}>
			<Sheet.Trigger
				class="flex min-h-11 w-full items-center justify-between rounded-md border border-line-2 px-3 text-sm font-medium text-ink-2 hover:bg-panel-2"
			>
				<span>{t.entry.sections.mobile.trigger}</span>
				<span aria-hidden="true">&#9662;</span>
			</Sheet.Trigger>
			<Sheet.Content
				side="bottom"
				class="h-[85vh] gap-0 overflow-y-auto p-0"
				closeLabel={t.entry.sections.mobile.closeLabel}
			>
				<Sheet.Title class="sr-only">{t.entry.sections.mobile.trigger}</Sheet.Title>
				<Sheet.Description class="sr-only">
					{t.entry.sections.mobile.description}
				</Sheet.Description>
				<EntrySections
					id="entry-detail-mobile"
					universeSlug={data.universe.slug}
					relations={data.relations}
					facts={data.facts}
					history={data.history}
					audit={data.audit.flags}
					bind:open={sectionsOpen}
					activeFactId={activeFact?.id ?? null}
					onFactToggle={toggleFact}
					media={mediaSectionData}
					locale={data.locale}
				/>
			</Sheet.Content>
		</Sheet.Root>
	</div>
</div>
