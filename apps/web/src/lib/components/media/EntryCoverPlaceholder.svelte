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
	 * in their HTML, not a slot hidden with CSS. The gallery is mounted inside this
	 * component for the same reason: one gate, not two.
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
	 * **It is an affordance, not a signpost.** Issue #385 (decision R10) retires the
	 * cover-only `EntryCoverDialog`: pressing this now opens the same `MediaGallery` the
	 * rail and the editor open, in full mode. "Use as cover" is still the accept and still
	 * lands on `media/cover`, which is where O2 put it - it is simply one action among the
	 * gallery's five now, upload and generate are its own ways in at the top, and there is
	 * no second, narrower surface duplicating any of that.
	 *
	 * Colours are the theme's own furniture tokens. Not the copilot's family: round eleven
	 * P2 is explicit that a hue marking chrome marks nothing, and an empty cover slot is
	 * furniture, with no word a model wrote anywhere near it.
	 *
	 * Round fourteen S5 (#410) repeals round thirteen R1 (#376): there is no more
	 * shape-driven placement, so this follows `EntryCover.svelte`'s own `variant` prop
	 * instead of `coverPlacement` - `"aside"` at the top of `EntrySections.svelte`, `md`
	 * and up, `"band"` (the default) above the title everywhere else. P6's own promise
	 * ("the page does not move when a cover arrives") still holds, because both variants
	 * borrow the real cover's own style helper for the shape it will actually be at.
	 */
	import type { EntityType } from '@canonry/db/schema';
	import { resolve } from '$app/paths';
	import { coverAsideStyle, coverBandStyle } from './cover-crop';
	import MediaGallery, { type MediaGalleryData } from './MediaGallery.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import { messages, type Locale } from '$lib/i18n';

	let {
		universeSlug,
		entitySlug,
		entityName,
		entityType,
		aiEnabled,
		hasImageStyle,
		canWrite,
		assets,
		coverAssetId,
		styleModifier,
		entityImagePromptModifier,
		portraitPrice,
		variantsPrice,
		portraitModel,
		variantsModel,
		locale,
		variant = 'band'
	}: {
		universeSlug: string;
		entitySlug: string;
		entityName: string;
		entityType: EntityType;
		aiEnabled: boolean;
		/** Issue #408, decision S3: threaded straight through into `galleryData` below -
		 * the actual generate-control gating lives in `MediaGallery.svelte` itself, since
		 * this placeholder only ever opens that same dialog. */
		hasImageStyle: boolean;
		canWrite: boolean;
		assets: MediaGalleryData['assets'];
		coverAssetId: string | null;
		styleModifier: string | null;
		entityImagePromptModifier: string | null;
		portraitPrice: number;
		variantsPrice: number;
		portraitModel: MediaGalleryData['portraitModel'];
		variantsModel: MediaGalleryData['variantsModel'];
		locale: Locale;
		variant?: 'band' | 'aside';
	} = $props();

	let t = $derived(messages(locale).entry.cover);
	let style = $derived(
		variant === 'aside' ? coverAsideStyle(entityType) : coverBandStyle(entityType)
	);
	let galleryOpen = $state(false);

	let galleryData = $derived<MediaGalleryData>({
		universeSlug,
		entitySlug,
		entityName,
		entityType,
		aiEnabled,
		hasImageStyle,
		canWrite,
		assets,
		coverAssetId,
		styleModifier,
		entityImagePromptModifier,
		portraitPrice,
		variantsPrice,
		portraitModel,
		variantsModel
	});
</script>

<button
	type="button"
	onclick={() => (galleryOpen = true)}
	class="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-2 bg-panel-2 px-4 text-center text-muted hover:border-accent hover:bg-panel hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	class:mb-6={variant === 'band' && hasImageStyle}
	{style}
>
	<span class="text-body font-medium">{t.placeholderAction}</span>
	<span class="text-label">{hasImageStyle ? t.placeholderHint : t.placeholderHintNoStyle}</span>
</button>
{#if !hasImageStyle}
	<!-- Issue #473: this world has no image style, so every generate control in the
	     dialog this opens (`MediaGallery`, decisions S3/T3) refuses. The box above says
	     what is available (upload) and names what unlocks the rest; this is a real,
	     separate link to the fix - it cannot nest inside the box's own `<button>` -
	     the same settings anchor `media.noStyle.link` already uses once the dialog is
	     open. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -- settings anchor:
	     resolve() plus a same-page fragment the rule cannot see through. -->
	<InlineLink
		href={`${resolve(`/w/${universeSlug}/settings`)}#setup-image-style`}
		class="-mt-1 block text-center text-label font-medium {variant === 'band' ? 'mb-6' : ''}"
	>
		{t.placeholderNoStyleLink}
	</InlineLink>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}

<MediaGallery bind:open={galleryOpen} data={galleryData} {locale} />
