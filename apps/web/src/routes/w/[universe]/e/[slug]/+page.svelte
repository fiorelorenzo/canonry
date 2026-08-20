<script lang="ts">
	/**
	 * The entry read view, B1 = C: a document plus a right column that switches between
	 * Relations, Facts, Images, History and Audit (C9 = B, #55). O2 (#284) put a cover band
	 * above the title, and round fourteen S5 (#410) moves it: every cover now lives at the
	 * top of that right column instead (`EntrySections.svelte`), at the column's own width
	 * and its natural height for the ratio, whatever the ratio is. S5 repeals round
	 * thirteen R1 (#376), which had stood a portrait cover beside the title in a header grid
	 * of its own, and #399's amendment of it - the article is a single measure column again.
	 * Below `md`, where that column is a bottom sheet the reader has to open (#148), the
	 * cover still draws as a band above the title here, because a sheet is not where a
	 * page's own picture belongs. Round eleven P6 reverses the one thing O2 refused: where
	 * there is no cover, somebody who can write to this world gets a placeholder that opens
	 * the media gallery, and a reader gets nothing. The language control that used to sit
	 * under the title is gone from here entirely, on the editor instead (#347): I5 keeps the
	 * only language switch in the reading chrome to the account menu's own, and an entry's
	 * language is a claim about its text, so it belongs where the text is written.
	 *
	 * Issue #148 (I10 = B): below `md` that right column can't sit beside the
	 * document, so it becomes reachable rather than cropped - `EntrySections` renders
	 * a second time inside a bottom `sheet`, opened by a trigger under the prose,
	 * instead of always stacking the whole panel under the article. Both copies share
	 * `sectionsOpen`, so opening a section in one is reflected in whichever the viewport
	 * shows next, and the sheet carries the same five sections with the same labels.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { messages } from '$lib/i18n';
	import EntryProseWithSecrets from '$lib/components/players/EntryProseWithSecrets.svelte';
	import EntrySections, {
		DEFAULT_SECTIONS_OPEN,
		type SectionOpenState
	} from '$lib/components/entry/EntrySections.svelte';
	import EntryCover from '$lib/components/media/EntryCover.svelte';
	import EntryCoverPlaceholder from '$lib/components/media/EntryCoverPlaceholder.svelte';
	import { coverSlot } from '$lib/components/media/cover-crop';
	import CompleteEntryControl from '$lib/components/entry/CompleteEntryControl.svelte';
	import AuditFlagBadge from '$lib/components/audit/AuditFlagBadge.svelte';
	import InlineProposalReview from '$lib/components/proposals/InlineProposalReview.svelte';
	import ModelRunning from '$lib/components/copilot/ModelRunning.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import type { FactRow } from '$lib/components/entry/FactsPanel.svelte';
	import type { FactSpan } from '$lib/markdown';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let t = $derived(messages(data.locale));

	let activeFact = $state<FactRow | null>(null);
	let sectionsOpen = $state<SectionOpenState>({ ...DEFAULT_SECTIONS_OPEN });
	let detailsOpen = $state(false);

	// #345: the two pieces the proposal region needs from the generator beside the title.
	// `completing` puts the spinner where the draft will land instead of beside the button,
	// and `reviewRegion` is what lets a finished draft take focus, so the keyboard path is
	// "Complete entry, then a" with no Tab in between.
	let completing = $state(false);
	let reviewRegion = $state<ReturnType<typeof InlineProposalReview> | null>(null);

	// An accept re-runs `load`, and the accepted proposal is no longer pending, so the region
	// would unmount the moment it succeeded and take C6's undo window with it. This keeps it
	// mounted for as long as we are still on the entry it did that work for, and drops it the
	// moment the route swaps to another entry (SvelteKit reuses this component across
	// `/e/<slug>` navigations, so a flag alone would carry the previous entry's card over).
	let regionEntityId = $state<string | null>(null);
	$effect(() => {
		if (data.proposals.reviewable.length > 0) regionEntityId = data.entity.id;
	});
	let regionMounted = $derived(
		data.proposals.reviewable.length > 0 || regionEntityId === data.entity.id
	);

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
		hasImageStyle: data.universe.hasImageStyle,
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

	// O2 (#284) for the band, round eleven P6 (#347) for the empty case: `coverSlot` owns
	// both answers, on `media.canWrite`, which the loader resolved from the caller's role.
	// The band reads the GM's own media route, which sits behind universe membership;
	// `/p/<slug>` builds its own URL from its own published-only resolution (guardrail 6).
	// Round fourteen S5 (#410): `cover`/`coverUrl` are also handed straight to
	// `EntrySections` for its own copy of the cover, `md` and up - one gate, read once,
	// rather than a second derivation that could someday disagree with this one.
	let cover = $derived(
		coverSlot({ coverAssetId: data.entity.coverAssetId, canWrite: data.media.canWrite })
	);
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

	// Round twelve Q5 (#366): the placeholder no longer points here. `openImagesSection` went
	// with it - the Images section is still reachable in the aside, and a cover is now
	// started where the placeholder stands.
</script>

<svelte:head><title>{data.entity.name} &middot; {data.universe.name}</title></svelte:head>

<!-- Q2 (round twelve): `md:min-h-full` gives this row a floor equal to `main`'s own
	resolved height (definite, since `main` is `flex-1` inside the shell's `h-screen`
	flex column - see AppShell.svelte), so the row is never shorter than the viewport
	even when the article is short. Without it, the row (and everything that stretches
	against it) only ever grows to match the article's own content height, which is
	exactly the near-empty-entry case that reads worst. -->
<div class="flex flex-col md:min-h-full md:flex-row">
	<article class="entry-article min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
		<p class="mb-3 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/w/${data.universe.slug}`)}>{data.universe.name}</a>
			/ {data.entity.type} /
			<span class="text-ink-2">{data.entity.name}</span>
		</p>

		<!-- Round fourteen S5 (#410): the aside's own copy of the cover (`EntrySections.svelte`)
		     only shows `md` and up, so this is the only copy a reader below `md` ever sees -
		     the aside there is a bottom sheet (#148), and a sheet the reader has to open is
		     not where a page's own picture goes. `variant="band"` is `EntryCover`'s default. -->
		<div class="md:hidden">
			{#if cover === 'band' && coverUrl}
				<EntryCover src={coverUrl} alt={data.entity.name} entityType={data.entity.type} />
			{:else if cover === 'placeholder'}
				<EntryCoverPlaceholder
					universeSlug={data.universe.slug}
					{...mediaSectionData}
					locale={data.locale}
				/>
			{/if}
		</div>

		<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
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
					{#if data.entity.aliases.length > 0}
						<span>{t.entry.page.aliasesLabel(data.entity.aliases.join(', '))}</span>
					{/if}
				</div>
			</div>
			<div class="flex flex-none items-start gap-2">
				<CompleteEntryControl
					aiEnabled={data.universe.aiEnabled}
					locale={data.locale}
					bind:running={completing}
					onDrafted={() => reviewRegion?.focusRegion()}
				/>
				<a
					href={resolve(`/w/${data.universe.slug}/e/${data.entity.slug}/edit`)}
					class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				>
					{t.entry.page.editLink}
				</a>
			</div>
		</div>

		<!-- #345: the review region, where the band used to point away from the page. C1 = B's
		     marking on the sentences below is still the "unmistakable" cue that something is
		     proposed; this is now the place the decision is actually made, in the reading
		     context, rather than a signpost to a screen that has it. The inbox and the plan
		     queue are unchanged and still own the twelve-at-once case (C2). -->
		{#if completing || regionMounted || data.proposals.awaitingDiff.count > 0}
			<div class="mb-6">
				{#if completing}
					<!-- The wait happens where the result will land, not up beside the button. -->
					<div class="rounded-lg border border-line bg-panel-2 p-3">
						<ModelRunning label={t.entry.complete.running} locale={data.locale} />
					</div>
				{/if}
				{#if regionMounted}
					<InlineProposalReview
						bind:this={reviewRegion}
						candidates={data.proposals.reviewable}
						universeSlug={data.universe.slug}
						locale={data.locale}
						onDecided={() => invalidateAll()}
					/>
				{/if}
				{#if data.proposals.awaitingDiff.count > 0}
					<!-- C3: a candidate with no drafted text yet is a decision about spending, and
					     that decision belongs on the plan's checklist. Accepting an empty diff in
					     place would be accepting something nobody could read. -->
					<p class="mb-0 text-xs text-muted">
						{t.proposals.inline.awaitingDiff(data.proposals.awaitingDiff.count)}
						<a
							class="text-accent hover:underline"
							href={data.proposals.awaitingDiff.planId
								? resolve(
										`/w/${data.universe.slug}/proposals/${data.proposals.awaitingDiff.planId}`
									)
								: resolve(`/w/${data.universe.slug}/proposals`)}
						>
							{t.proposals.inline.awaitingDiffLink}
						</a>
					</p>
				{/if}
			</div>
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
			{cover}
			{coverUrl}
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
				<!-- Round fourteen S5 (#410): `cover="none"`, not `{cover}` - the mobile band
				     above the title (in the article, `md:hidden`) is already this reader's one
				     copy of the cover, visible without opening the sheet at all. Showing it
				     again as the first thing inside the sheet would be the same picture twice
				     for one tap, and the placeholder's gallery affordance is reachable from
				     the band already. -->
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
					cover="none"
					coverUrl={null}
					locale={data.locale}
				/>
			</Sheet.Content>
		</Sheet.Root>
	</div>
</div>
