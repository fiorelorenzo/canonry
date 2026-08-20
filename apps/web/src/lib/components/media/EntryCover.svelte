<script lang="ts">
	/**
	 * O2 (#284): the cover band above an entry's title, on both the GM's entry page and the
	 * players' wiki.
	 *
	 * Three rules from the decision, all of them here rather than at either call site:
	 *
	 * 1. **Capped at a fifth of the first screenful.** A cover never gets to own the top of the
	 *    page, however tall the picture behind it is.
	 * 2. **Ratio by entity type**, portrait for a character and an item, wide for a place, an
	 *    event and a session (round twelve Q5 re-derived the table; O2's own words said
	 *    "closer to square for a person" and the table it shipped with did not). Rules 1 and 2
	 *    used to be in conflict, and `coverBandStyle` in `cover-crop.ts` is where that is
	 *    resolved: the box is sized by the cap and takes its width from the ratio, rather than
	 *    taking the column's full width and having its height clipped, which is what made every
	 *    cover draw as the same wide strip.
	 * 3. **Positioned rather than stretched.** `object-cover` plus a per-type `object-position`.
	 *    A generated cover is drawn at this exact shape now, so there is nothing for it to
	 *    reconcile; an uploaded or imported file is whatever shape its author made it, and a
	 *    character's keeps the top of the picture, because that is where a face is. Nothing is
	 *    ever squashed to fit.
	 *
	 * There is deliberately no empty state in *this* component, and that is no longer the
	 * whole decision. O2 refused a placeholder outright; round eleven P6 reverses that
	 * narrowly, for somebody who can write to the world only, and
	 * `EntryCoverPlaceholder.svelte` is where that lives. The split is the point: this file
	 * still takes a `src: string` and still has no "absent" branch to get wrong, the
	 * placeholder is a separate mount behind `coverSlot`, and the players' wiki imports this
	 * one alone. O2's reason for the refusal survives inside P6 rather than being overruled
	 * by it: a reader who cannot write is shown no slot at all.
	 *
	 * `src` arrives already resolved, so this component knows nothing about which surface it
	 * is on and cannot second-guess who may see the picture. Guardrail 6 lives in the two
	 * loaders: the GM page passes `entity.coverAssetId` straight through, and the players'
	 * page passes `coverImageId`, which `publicEntityBySlug` only fills in for an asset that
	 * already cleared the published/gm_only/revelation gate.
	 */
	import type { EntityType } from '@canonry/db/schema';
	import { COVER_POSITION, coverBandStyle } from './cover-crop';

	let { src, alt, entityType }: { src: string; alt: string; entityType: EntityType } = $props();

	// Both maps moved to `cover-crop.ts` when O1 (#283) gave a cover its second surface, the
	// world home's Continue cards: rules 2 and 3 above are the same decision at both sizes.
	let position = $derived(COVER_POSITION[entityType]);
</script>

<div
	class="mb-6 overflow-hidden rounded-md border border-line bg-panel-2"
	style={coverBandStyle(entityType)}
>
	<img {src} {alt} class="h-full w-full object-cover" style="object-position: {position}" />
</div>
