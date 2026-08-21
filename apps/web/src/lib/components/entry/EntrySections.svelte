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
	 *
	 * Round fourteen S5 (#410) puts the entry's cover here too, above Relations: the aside
	 * "is where a cover belongs and it was there all along" - it is already the entry's
	 * structured column, and it already runs the full height of the page (Q2, unchanged by
	 * round sixteen's U5 - see the comment on `<aside>` below for what U5 actually dropped).
	 * `cover` and `coverUrl` carry `+page.svelte`'s own `coverSlot()`/`resolve()` answers
	 * rather than being re-derived here, so the gate (`canWrite`) still lives in exactly
	 * one place. `EntryCover`/`EntryCoverPlaceholder` render with `variant="aside"`, which
	 * takes the width the aside already has (`md:w-64` below) and a height that follows
	 * from the ratio alone - "natural height", tall for a character, short for a place. A
	 * tall portrait simply pushes the column taller now, the same way a sixth open section
	 * would - there is no scroll of any kind inside this component to hide anything
	 * under it.
	 *
	 * The caller passes `cover="none"` for the mobile sheet mount (`+page.svelte`'s second
	 * `EntrySections`, id `entry-detail-mobile`): a mobile reader already sees the cover as
	 * a band above the title before opening anything (`EntryCover` with the default
	 * `variant="band"`, mounted separately there), so drawing it again behind the sheet
	 * trigger would be the same picture twice for one tap.
	 */
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { messages, type Locale } from '$lib/i18n';
	import type { RelationView } from '@canonry/db';
	import type { EntityType } from '@canonry/db/schema';
	import RelationsPanel from './RelationsPanel.svelte';
	import FactsPanel, { type FactRow } from './FactsPanel.svelte';
	import EntryMediaPanel from '../media/EntryMediaPanel.svelte';
	import HistoryPanel, { type RevisionRow } from './HistoryPanel.svelte';
	import AuditFlagsPanel, { type AuditFlagView } from '../audit/AuditFlagsPanel.svelte';
	import EntryCover from '../media/EntryCover.svelte';
	import EntryCoverPlaceholder from '../media/EntryCoverPlaceholder.svelte';
	import MediaGallery, { type MediaGalleryData } from '../media/MediaGallery.svelte';
	import MentionPreview from './MentionPreview.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ImageUpIcon from '@lucide/svelte/icons/image-up';
	import ImageOffIcon from '@lucide/svelte/icons/image-off';

	type ModelSummary = { provider: string; modelId: string } | null;
	interface MediaAssetView {
		id: string;
		mimeType: string;
		generated: boolean;
		gmOnly: boolean;
		credits: number;
		createdAt: string | Date;
	}
	interface MediaSectionData {
		entitySlug: string;
		entityName: string;
		entityType: EntityType;
		aiEnabled: boolean;
		/** Issue #408, decision S3: threaded straight through to `EntryMediaPanel.svelte`,
		 * which threads it to `MediaGallery.svelte` - the actual generate-control gating
		 * lives there. */
		hasImageStyle: boolean;
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
		cover,
		coverUrl,
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
		/** Round fourteen S5 (#410): `coverSlot()`'s own answer, resolved once by the
		 * caller so this component's `canWrite` gate cannot drift from `media`'s. */
		cover: 'band' | 'placeholder' | 'none';
		coverUrl: string | null;
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

	// U5 (round sixteen, #453): this aside is now `MentionPreview.svelte`'s `container`
	// for the relation links `RelationsPanel` renders below, the same contract
	// `Sidebar.svelte`'s own `container` carries for its Recents list (#429/T2) - one
	// listener on the aside, delegated, `position: relative` on it (see `<aside>` below)
	// so the card can position itself against it.
	let container = $state<HTMLElement | null>(null);

	// U6 (round sixteen, #453): a cover already set gets replace and remove where it
	// stands - Replace opens the same `MediaGallery` `EntryCoverPlaceholder` opens for
	// the unset case (full mode, "use as cover" among its five actions), Remove posts the
	// same `{ mediaAssetId: null }` that gallery's own "Remove as cover" button already
	// sends. Neither is a new write path; both go through `media/cover`, the one place
	// `entity.cover_asset_id` ever changes (that route's own doc comment).
	let coverGalleryOpen = $state(false);
	let removingCover = $state(false);
	let coverError = $state<string | null>(null);
	let coverGalleryData = $derived<MediaGalleryData>({ universeSlug, ...media });
	let mediaBase = $derived(resolve(`/w/${universeSlug}/e/${media.entitySlug}/media`));

	async function removeCover(): Promise<void> {
		coverError = null;
		removingCover = true;
		try {
			const res = await fetch(`${mediaBase}/cover`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mediaAssetId: null })
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.cover.genericCoverFailedWithStatus(res.status));
			}
			await invalidateAll();
		} catch (err) {
			coverError = err instanceof Error ? err.message : t.entry.media.cover.genericCoverFailed;
		} finally {
			removingCover = false;
		}
	}
</script>

<!-- U5 (round sixteen, #453) drops the aside's own scroll: `md:sticky md:top-0
	md:max-h-[calc(100vh-4rem)] md:overflow-y-auto` capped this column at one viewport and
	scrolled whatever spilled past inside it, so a document longer than the aside produced
	two scrollbars side by side and the mouse wheel did something different depending on
	which column the pointer sat over. The page keeps the only scrollbar now: this is a
	normal block in the row's flow, and once every section is open it simply grows past
	the fold the way the rest of the page already does - no sticky, no internal scroll,
	nothing declared for overflow at all (the default is `visible`).

	Q2 (round twelve) survives as `md:min-h-full`, not `md:h-full`: a bare `height` is a
	cap, not a floor - a block with an explicit `height` shorter than its own content and
	`overflow: visible` (the default, and exactly what U5 wants) paints that content past
	its bottom edge without the extra space ever counting toward the page's own scrollable
	height, which reintroduces a clipped-looking column by a different mechanism than the
	one U5 just removed. `min-height` has no such ceiling: the caller wraps this component
	in a plain block div (`hidden md:block` in +page.svelte), and that wrapper is what
	actually receives the row's stretched height via the default flex `align-items:
	stretch` - this element does not inherit it just by sitting inside a taller box, it
	still sizes itself by its own content unless told to fill. On a short entry with every
	section closed, `md:min-h-full` is what keeps this column running to the bottom of a
	tall article instead of stopping a third of the way down; on a long entry with every
	section open, the column's own content is already taller than that floor, and being a
	floor rather than a cap, the column (and the row, and the page under it) simply grows
	to fit it. `md:` only - inside #148's bottom sheet the sheet itself is still the
	scroller, untouched by any of this. -->
<aside
	{id}
	bind:this={container}
	class="relative w-full border-line bg-panel-2 md:min-h-full md:w-64 md:flex-none md:border-l"
	aria-label={t.entry.sections.ariaLabel}
>
	<!-- Round fourteen S5 (#410): the cover, above Relations, at the aside's own width and
		its natural height for the ratio. `border-b` matches the rhythm the sections below
		already use, so the cover reads as this column's own first item rather than a
		second thing bolted above it.

		U6 (round sixteen, #453): a cover already set gets replace and remove where it
		stands, on hover and on focus, in the icon-button-plus-tooltip shape
		`FormattingToolbar.svelte` established for Q4. A plain CSS `group-hover`/
		`group-focus-within` reveal is enough here, unlike `ImageWidthControl.svelte`'s own
		pointer/focus delegation: that control sits over an image `{@html}` put in the DOM,
		with no Svelte node to bind to, while this cover is ordinary Svelte markup this
		component already owns. Replace opens the same `MediaGallery` the placeholder below
		opens (full mode, "use as cover" one action among its five); Remove posts the exact
		body that gallery's own "Remove as cover" button already sends, directly, since
		there is nothing to pick for an unset. Neither is a new write path (see
		`removeCover` above). Gated on `media.canWrite`: `coverSlot` returns `'band'` for a
		reader too - seeing a published cover is not gated, only changing it is, so this
		overlay is the one thing here that has to ask again rather than inherit the branch. -->
	{#if cover === 'band' && coverUrl}
		<div class="border-b border-line p-4">
			<div class="cover-actions relative">
				<EntryCover
					src={coverUrl}
					alt={media.entityName}
					entityType={media.entityType}
					variant="aside"
				/>
				{#if media.canWrite}
					<Tooltip.Provider delayDuration={400}>
						<div class="cover-actions-overlay absolute top-2 right-2 flex gap-1 transition-opacity">
							<Tooltip.Root>
								<Tooltip.Trigger onclick={() => (coverGalleryOpen = true)}>
									{#snippet child({ props })}
										<Button
											{...props}
											type="button"
											variant="secondary"
											size="icon"
											class="size-8 bg-panel shadow"
											aria-label={t.entry.media.cover.replaceLabel}
										>
											<ImageUpIcon aria-hidden="true" />
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>{t.entry.media.cover.replaceLabel}</Tooltip.Content>
							</Tooltip.Root>
							<Tooltip.Root>
								<Tooltip.Trigger onclick={() => void removeCover()}>
									{#snippet child({ props })}
										<Button
											{...props}
											type="button"
											variant="secondary"
											size="icon"
											class="size-8 bg-panel shadow"
											disabled={removingCover}
											aria-label={t.entry.media.cover.removeLabel}
										>
											<ImageOffIcon aria-hidden="true" />
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>{t.entry.media.cover.removeLabel}</Tooltip.Content>
							</Tooltip.Root>
						</div>
					</Tooltip.Provider>
				{/if}
			</div>
			{#if coverError}
				<p class="mt-2 text-xs text-danger">{coverError}</p>
			{/if}
		</div>
		<MediaGallery bind:open={coverGalleryOpen} data={coverGalleryData} {locale} />
	{:else if cover === 'placeholder'}
		<div class="border-b border-line p-4">
			<EntryCoverPlaceholder {universeSlug} {...media} {locale} variant="aside" />
		</div>
	{/if}

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
						aiEnabled={media.aiEnabled}
						hasImageStyle={media.hasImageStyle}
						entitySlug={media.entitySlug}
						entityName={media.entityName}
						entityType={media.entityType}
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
					<HistoryPanel revisions={history} {universeSlug} {locale} />
				{:else}
					<AuditFlagsPanel flags={audit} {universeSlug} {locale} />
				{/if}
			</div>
		</details>
	{/each}

	<!-- U5 (round sixteen, #453): the relation links `RelationsPanel` renders above carry
		`data-entry-slug` now, the same marker #442/#429 wired the sidebar's Recents off
		of, and this is that mount for this column - one instance per aside, delegated off
		`container` (bound above), not one per link. -->
	<MentionPreview {container} {universeSlug} surface="gm" {locale} />
</aside>

<style>
	/* U6 (round sixteen, #453): plain scoped CSS rather than Tailwind's `group-hover`/
		`group-focus-within` variants - this is the first call site in the app to reach for
		either, and relying on component-scoped CSS here needs no utility-class discovery
		to have already run for a combination nothing else in the codebase uses yet. The
		rule is exactly what the two variants would have expressed: the overlay stays
		invisible until the pointer or the keyboard reaches the cover or one of its own
		buttons. */
	.cover-actions-overlay {
		opacity: 0;
	}
	.cover-actions:hover > .cover-actions-overlay,
	.cover-actions:focus-within > .cover-actions-overlay {
		opacity: 1;
	}
</style>
