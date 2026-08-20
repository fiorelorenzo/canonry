<script lang="ts">
	/**
	 * Round eleven P6, which reverses O2 (#284) narrowly: an entry with no cover shows a
	 * placeholder, and only to somebody who can write to that world. Round twelve's Q5
	 * (#366) amends P6 a day later: it asks upload or generate where it stands, instead of
	 * pointing at the Images section.
	 *
	 * O2's reason for refusing a placeholder is the reason this file exists as its own
	 * component rather than as an absent branch inside `EntryCover.svelte`. That reason was
	 * a reader being shown an invitation they cannot accept, and it survives untouched:
	 * `coverSlot` in `cover-crop.ts` decides whether this is mounted at all, on data the
	 * server resolved, and the players' wiki (`/p/<universe>/<slug>`) imports `EntryCover`
	 * alone, so that surface cannot render this even by mistake. A reader receives no slot
	 * in their HTML, not a slot hidden with CSS. The dialog is mounted inside this component
	 * for the same reason: one gate, not two.
	 *
	 * Three things it borrows from the real band, because the point of a placeholder is that
	 * the page does not move when a cover arrives:
	 * 1. **The same shape**, through the same `coverBandStyle`, so a character's empty slot
	 *    is the shape a character's cover will be.
	 * 2. **The same cap**, a fifth of the first screenful, which that helper also owns.
	 * 3. **The same box**: rounded, one border, the same margin under it. What differs is
	 *    that the border is dashed and there is no `<img>` at all - no broken-image glyph, no
	 *    `alt` text standing in for a picture that was never there, because nothing failed to
	 *    load.
	 *
	 * **It is an affordance, not a signpost.** Pressing it opens `EntryCoverDialog`, which
	 * carries both paths and states what each costs; the accept for a generated image is
	 * still "use as cover" and still lands on `media/cover`, which is where O2 put it. The
	 * price and the model name live in the dialog rather than on this button, because a
	 * button that has not been pressed yet has no business quoting a price for a path the
	 * reader may not take.
	 *
	 * Colours are the theme's own furniture tokens. Not the copilot's family: round eleven
	 * P2 is explicit that a hue marking chrome marks nothing, and an empty cover slot is
	 * furniture, with no word a model wrote anywhere near it.
	 *
	 * Round thirteen R1 (#376): the placeholder follows `coverPlacement`, the same call
	 * `EntryCover.svelte` makes, so a portrait entry's empty slot is already standing
	 * beside the title before it has a picture - the one thing that would defeat P6's own
	 * promise ("the page does not move when a cover arrives") is a placeholder that sits
	 * above the title while its own cover, once accepted, would stand beside it.
	 */
	import type { EntityType } from '@canonry/db/schema';
	import { coverBandStyle, coverFigureStyle, coverPlacement } from './cover-crop';
	import EntryCoverDialog from './EntryCoverDialog.svelte';
	import { messages, type Locale } from '$lib/i18n';

	let {
		entityType,
		universeSlug,
		entrySlug,
		entityName,
		aiEnabled,
		portraitPrice,
		portraitModel,
		locale
	}: {
		entityType: EntityType;
		universeSlug: string;
		entrySlug: string;
		entityName: string;
		aiEnabled: boolean;
		portraitPrice: number;
		portraitModel: { provider: string; modelId: string } | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).entry.cover);
	let placement = $derived(coverPlacement(entityType));
	let bandStyle = $derived(coverBandStyle(entityType));
	let figureStyle = $derived(coverFigureStyle(entityType));
	let dialogOpen = $state(false);
</script>

{#if placement === 'figure'}
	<button
		type="button"
		onclick={() => (dialogOpen = true)}
		class="mb-6 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-2 bg-panel-2 px-4 text-center text-muted hover:border-accent hover:bg-panel hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:hidden"
		style={bandStyle}
	>
		<span class="text-sm font-medium">{t.placeholderAction}</span>
		<span class="text-xs">{t.placeholderHint}</span>
	</button>
	<button
		type="button"
		onclick={() => (dialogOpen = true)}
		class="mb-6 hidden flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-2 bg-panel-2 px-3 text-center text-muted hover:border-accent hover:bg-panel hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:flex"
		style={figureStyle}
	>
		<span class="text-xs font-medium">{t.placeholderAction}</span>
		<span class="text-[11px]">{t.placeholderHint}</span>
	</button>
{:else}
	<button
		type="button"
		onclick={() => (dialogOpen = true)}
		class="mb-6 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-2 bg-panel-2 px-4 text-center text-muted hover:border-accent hover:bg-panel hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		style={bandStyle}
	>
		<span class="text-sm font-medium">{t.placeholderAction}</span>
		<span class="text-xs">{t.placeholderHint}</span>
	</button>
{/if}

<EntryCoverDialog
	bind:open={dialogOpen}
	{universeSlug}
	{entrySlug}
	{entityName}
	{aiEnabled}
	{portraitPrice}
	{portraitModel}
	{locale}
/>
