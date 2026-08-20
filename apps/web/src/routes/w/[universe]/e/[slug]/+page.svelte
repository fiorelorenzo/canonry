<script lang="ts">
	/**
	 * The entry read view, B1 = C: a document plus a right column that switches between
	 * Relations, Facts, Images, History and Audit (C9 = B, #55). O2 (#284) changed what the
	 * (`EntrySections`), and a cover band sits above the title when the entry has one. Round
	 * eleven P6 reverses the one thing O2 refused: where there is no cover, somebody who can
	 * write to this world gets a placeholder that opens the Images section, and a reader gets
	 * nothing. The language control that used to sit under the title is gone from here
	 * entirely, on the editor instead (#347): I5 keeps the only language switch in the
	 * reading chrome to the account menu's own, and an entry's language is a claim about its
	 * text, so it belongs where the text is written.
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
	import { coverPlacement, coverSlot } from '$lib/components/media/cover-crop';
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
	let cover = $derived(
		coverSlot({ coverAssetId: data.entity.coverAssetId, canWrite: data.media.canWrite })
	);
	let coverUrl = $derived(
		data.entity.coverAssetId
			? resolve(`/w/${data.universe.slug}/e/${data.entity.slug}/media/${data.entity.coverAssetId}`)
			: null
	);

	// Round thirteen R1 (#376): the placement is the ratio's answer, not a second table
	// keyed on entity type, so `EntryCover`/`EntryCoverPlaceholder` and this page's own
	// header grid can never disagree about which shape a given entity gets. `coverBeside`
	// only reserves the header's figure column when there is actually something to put in
	// it - the `cover === 'none'` reader never gets a slot, so there is nothing for that
	// reader's header to move around either.
	let placement = $derived(coverPlacement(data.entity.type));
	let coverBeside = $derived(placement === 'figure' && cover !== 'none');

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
	<article
		class="entry-article min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8"
		class:entry-article--figure={coverBeside}
	>
		<div class="cover-header">
			<p class="cover-header__breadcrumb mb-3 text-xs text-muted">
				<a class="hover:underline" href={resolve(`/w/${data.universe.slug}`)}
					>{data.universe.name}</a
				>
				/ {data.entity.type} /
				<span class="text-ink-2">{data.entity.name}</span>
			</p>

			<div class="cover-header__cover">
				{#if cover === 'band' && coverUrl}
					<EntryCover src={coverUrl} alt={data.entity.name} entityType={data.entity.type} />
				{:else if cover === 'placeholder'}
					<EntryCoverPlaceholder
						entityType={data.entity.type}
						universeSlug={data.universe.slug}
						entrySlug={data.entity.slug}
						entityName={data.entity.name}
						aiEnabled={data.universe.aiEnabled}
						portraitPrice={data.media.generate.portrait.price}
						portraitModel={data.media.generate.portrait.model}
						locale={data.locale}
					/>
				{/if}
			</div>

			<div class="cover-header__title mb-6 flex flex-wrap items-start justify-between gap-4">
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

<style>
	/* Round thirteen R1 (#376), amended in review: a portrait cover stands beside the title
	 * once the row has the room for it - `64rem` is Tailwind's own `lg`, the same breakpoint
	 * `EntryCover` and `EntryCoverPlaceholder` switch their own box on, so the two never
	 * disagree about which shape is showing. Below it, and for any entity type that never
	 * gets `.entry-article--figure` at all (`coverBeside` above), this is a plain block in
	 * source order - breadcrumb, cover, title - exactly what it was before the decision,
	 * which is what keeps a landscape entry unchanged.
	 *
	 * The grid is on the article rather than on the header, and that is the part worth
	 * reading. #376 first put it on the header alone, with areas `title cover`, which made
	 * the header's second row as tall as the figure: a 3:4 cover at 12.5rem is about 330px,
	 * so the body started 250px of blank paper below the aliases line. Rendered, it looked
	 * like a bug rather than a decision. Here the header is `display: contents`, so the
	 * breadcrumb, the title block and the cover are grid items of the article itself, and
	 * the cover spans `2 / -1`: its height is absorbed by the title plus everything below
	 * instead of forcing one row open. `align-self: start` keeps it at the top of that span,
	 * beside the title, which is where R1 says it goes.
	 *
	 * Everything else in the article is column 1, so the prose keeps the measure it had and
	 * no line moves because a cover exists. `12.5rem` is `COVER_FIGURE_WIDTH` in
	 * `cover-crop.ts`, restated here because a grid column and a child's own `aspect-ratio`
	 * box are two different properties with no single declaration that sets both; that
	 * constant's doc comment is the note that keeps the two from drifting. The first column
	 * is `--container-measure` capped with `minmax` rather than fixed, so a `lg` viewport
	 * narrower than measure-plus-figure still fits instead of overflowing the row. */
	@media (min-width: 64rem) {
		.entry-article--figure {
			display: grid;
			grid-template-columns: minmax(0, var(--container-measure)) 12.5rem;
			column-gap: 1.5rem;
			align-content: start;
		}

		.entry-article--figure > :global(*) {
			grid-column: 1;
			min-width: 0;
		}

		.entry-article--figure .cover-header {
			display: contents;
		}

		.entry-article--figure .cover-header__breadcrumb {
			grid-column: 1 / -1;
		}

		.entry-article--figure .cover-header__title {
			grid-column: 1;
		}

		.entry-article--figure .cover-header__cover {
			grid-column: 2;
			/* `span 100`, not `2 / -1`: a negative row line resolves against the EXPLICIT grid,
			 * and this grid declares no rows at all, so `-1` is line 1 and the browser swaps
			 * the pair into a single row 1. Rendered, that put the figure above the breadcrumb
			 * and opened a 330px row anyway, which is the same defect one line further up. A
			 * plain large span reaches the implicit rows, which is where the article's content
			 * actually lives. */
			grid-row: 2 / span 100;
			align-self: start;
		}
	}
</style>
