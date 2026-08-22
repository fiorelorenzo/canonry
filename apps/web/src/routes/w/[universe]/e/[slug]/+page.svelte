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
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
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
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Segmented, type SegmentedOption } from '$lib/components/ui/segmented';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import type { FactRow } from '$lib/components/entry/FactsPanel.svelte';
	import type { FactSpan } from '$lib/markdown';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let t = $derived(messages(data.locale));

	let activeFact = $state<FactRow | null>(null);
	let sectionsOpen = $state<SectionOpenState>({ ...DEFAULT_SECTIONS_OPEN });
	let detailsOpen = $state(false);

	// Round fifteen T1 (#428), moved again by round sixteen U4 (#452): `EntryProseWithSecrets`'s
	// own GM/player view control (#383/#409) renders here, on the title's own row beside the
	// write controls, instead of inside that component or on a row of its own beneath the
	// title - `showViewControl={false}` on it below keeps it from drawing a second copy of
	// either the control or the sentence under it (see that component's doc comment on
	// `showViewControl`). `$props.id()` is this component's own instance suffix, the same
	// reason `EntryProseWithSecrets` gives it: `Segmented` groups its native radios by `name`.
	let view = $state<'gm' | 'player'>('gm');
	const viewUid = $props.id();
	const viewName = `entry-view-${viewUid}`;
	const viewOptions = $derived<SegmentedOption[]>([
		{ value: 'gm', label: t.entry.prose.gmView },
		{ value: 'player', label: t.entry.prose.playersView }
	]);

	// #345: the two pieces the proposal region needs from the generator beside the title.
	// `completing` puts the spinner where the draft will land instead of beside the button,
	// and `reviewRegion` is what lets a finished draft take focus, so the keyboard path is
	// "Complete entry, then a" with no Tab in between.
	let completing = $state(false);
	let reviewRegion = $state<ReturnType<typeof InlineProposalReview> | null>(null);
	// Round fifteen T1 (#428): the empty/failure sentence `CompleteEntryControl` used to
	// print under its own text button. Bound out for the same reason `completing` is -
	// the review region below is "where the draft would have landed", and now shows this
	// too, instead of a message with nowhere left to sit once the button became a glyph.
	let completeMessage = $state<string | null>(null);

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

<PageHeader title={data.entity.name}>
	{#snippet titleAdornment()}
		<AuditFlagBadge
			count={data.audit.flags.length}
			onOpen={openAuditSection}
			locale={data.locale}
		/>
	{/snippet}
	{#snippet actions()}
		<!-- U4 (#452, round sixteen): the view control joins the write controls in the
		     band's own actions row instead of wasting a row of its own underneath the
		     title - it is the least consequential of the three, so it gets the same
		     fixed-size treatment the icon buttons already have (S4). `EntryProseWithSecrets`
		     still owns the prose/mention rendering this drives (`showViewControl={false}`,
		     `bind:view` below); only where the control draws moved - that component's own
		     doc comment on `showViewControl` has the rule this page follows. -->
		<Segmented
			name={viewName}
			bind:value={view}
			options={viewOptions}
			ariaLabel={t.entry.prose.viewAriaLabel}
			class="shrink-0"
		/>
		<!-- T1 (#428): `Completa la voce` and `Modifica` are icon buttons sharing the
		     band's own actions row - the pattern `FormattingToolbar.svelte`'s `iconButton`
		     snippet already uses (Q4): one shared `Tooltip.Provider`, a `Tooltip.Root` per
		     control, an `aria-label` plus the tooltip carrying the name. -->
		<Tooltip.Provider delayDuration={400}>
			<div class="flex items-center gap-1">
				<CompleteEntryControl
					aiEnabled={data.universe.aiEnabled}
					price={data.complete.price}
					locale={data.locale}
					bind:running={completing}
					onMessage={(m) => (completeMessage = m)}
					onDrafted={() => reviewRegion?.focusRegion()}
				/>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								href={resolve(`/w/${data.universe.slug}/e/${data.entity.slug}/edit`)}
								variant="ghost"
								size="icon"
								aria-label={t.entry.page.editLink}
							>
								<SquarePenIcon aria-hidden="true" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>{t.entry.page.editLink}</Tooltip.Content>
				</Tooltip.Root>
			</div>
		</Tooltip.Provider>
	{/snippet}
</PageHeader>

<!-- V1 = B's three widths apply to a page's own body, and this body is two columns: the
     article and the aside (S5). `reading` caps the *pair* at 44rem, which leaves the
     article 448px once the 256px aside is subtracted - narrower than
     `--container-measure`'s own 34rem, so the prose stopped reaching its own measure and
     the whole row floated in the middle of 1184px with 240px of paper on either side.
     `working` gives the pair 62rem, so the article clears the measure and the prose
     narrows on its own element, which is where the reading width was always meant to be
     enforced (`page-body.svelte`'s own doc comment says so). -->
<PageBody width="working">
	<!-- Q2 (round twelve): `md:min-h-full` gives this row a floor equal to `main`'s own
	resolved height (definite, since `main` is `flex-1` inside the shell's `h-screen`
	flex column - see AppShell.svelte), so the row is never shorter than the viewport
	even when the article is short. Without it, the row (and everything that stretches
	against it) only ever grows to match the article's own content height, which is
	exactly the near-empty-entry case that reads worst. -->
	<div class="flex flex-col md:min-h-full md:flex-row">
		<article class="entry-article min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
			<!-- Issue #473: the type used to repeat here and again as the badge under the
		     title below. This line is the only linked segment (the universe name), so
		     it stays pure navigation; the type is metadata and the badge already says
		     it with more visual weight (accent pill vs. plain text) right beside the
		     name it describes. -->
			<p class="mb-3 text-xs text-muted">
				<a class="hover:underline" href={resolve(`/w/${data.universe.slug}`)}
					>{data.universe.name}</a
				>
				/
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

			<div class="mb-6">
				<div class="flex flex-wrap items-center gap-2 text-sm text-muted">
					<span class="rounded-full bg-accent-bg px-2 py-0.5 font-mono text-xs text-accent-ink">
						{data.entity.type}
					</span>
					{#if data.entity.aliases.length > 0}
						<span>{t.entry.page.aliasesLabel(data.entity.aliases.join(', '))}</span>
					{/if}
					{#if !data.universe.aiEnabled}
						<!-- Guardrail 4: the reason stays a plain, always-visible sentence rather than
					     living only in the complete icon's own tooltip, which needs a hover or
					     focus nobody is required to give it - CompleteEntryControl.svelte's own
					     comment has the rest of this decision. -->
						<span>{t.entry.complete.aiOff}</span>
					{/if}
				</div>
				<!-- U4 (#452): this used to be its own bordered row under the title, holding
			     both the control and the sentence; the control moved above, onto the
			     title's row, and only the sentence stays here - always present, always one
			     line (S4), so toggling the control above it never moves the article that
			     follows. This page draws the control, so this page draws the sentence
			     (see `EntryProseWithSecrets.svelte`'s `showViewControl` doc comment for
			     the rule): fixing #452's duplicate, this used to also print from that
			     component's own `{:else}` branch when `showViewControl` was `false`. -->
				<p class="mt-3 border-b border-line pb-3 text-xs text-muted">
					{view === 'player' ? t.entry.prose.playerPreviewActive : t.entry.prose.gmViewDescription}
				</p>
			</div>

			<!-- #345: the review region, where the band used to point away from the page. C1 = B's
		     marking on the sentences below is still the "unmistakable" cue that something is
		     proposed; this is now the place the decision is actually made, in the reading
		     context, rather than a signpost to a screen that has it. The inbox and the plan
		     queue are unchanged and still own the twelve-at-once case (C2). -->
			{#if completing || completeMessage || regionMounted || data.proposals.awaitingDiff.count > 0}
				<div class="mb-6">
					{#if completing}
						<!-- The wait happens where the result will land, not up beside the button. -->
						<div class="rounded-lg border border-line bg-panel-2 p-3">
							<ModelRunning label={t.entry.complete.running} locale={data.locale} />
						</div>
					{:else if completeMessage}
						<!-- T1 (#428): same rule, extended from the wait to its outcome - the empty
					     or failure sentence lands where the draft would have, not beside the
					     button that no longer has room for it. -->
						<div class="rounded-lg border border-line bg-panel-2 p-3 text-xs text-muted">
							{completeMessage}
						</div>
					{/if}
					{#if regionMounted}
						<InlineProposalReview
							bind:this={reviewRegion}
							candidates={data.proposals.reviewable}
							universeSlug={data.universe.slug}
							locale={data.locale}
							headingLevel={2}
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
				markedSentences={new Map(
					data.proposals.markedSentences.map((m) => [
						m.sentence,
						{ proposalId: m.proposalId, planId: m.planId }
					])
				)}
				bind:view
				showViewControl={false}
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
				revealedIn={data.entity.revealedIn}
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
						revealedIn={data.entity.revealedIn}
						locale={data.locale}
					/>
				</Sheet.Content>
			</Sheet.Root>
		</div>
	</div>
</PageBody>
