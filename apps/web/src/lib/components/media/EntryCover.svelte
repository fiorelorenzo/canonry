<script lang="ts">
	/**
	 * O2 (#284): the cover band above an entry's title, on both the GM's entry page and the
	 * players' wiki.
	 *
	 * Three rules from the decision, all of them here rather than at either call site:
	 *
	 * 1. **Capped at a fifth of the first screenful.** `max-h-[20vh]` is a hard ceiling, not
	 *    a suggestion: a cover never gets to own the top of the page, however tall the
	 *    picture behind it is.
	 * 2. **Ratio by entity type**, wide for a place and closer to square for a person. The
	 *    consequence of rule 1 is worth stating rather than hiding: on a wide document
	 *    column the cap is what binds (a 21:9 band across 800px would be 343px, well over a
	 *    fifth of a laptop screen), so the type's ratio is what the band actually draws only
	 *    on a narrow column, a phone or a split window. It still decides the shape the source
	 *    is cropped to in every case, which is the part that matters for whether a portrait
	 *    survives being put in a band.
	 * 3. **Positioned rather than stretched.** `object-cover` plus a per-type
	 *    `object-position`: a character's band keeps the top of the picture, because that is
	 *    where a face is, and everything else keeps the middle. Nothing is ever squashed to
	 *    fit.
	 *
	 * There is deliberately no empty state. An entry with no cover renders no band and no
	 * dashed placeholder either, which is the amendment the decision carried: a slot that is
	 * empty on every thin entry reads worse than no slot, and a GM who cannot write to that
	 * world would be looking at an invitation they cannot accept. The caller therefore
	 * mounts this component only when there is a cover, and this component has no "absent"
	 * branch to get wrong.
	 *
	 * `src` arrives already resolved, so this component knows nothing about which surface it
	 * is on and cannot second-guess who may see the picture. Guardrail 6 lives in the two
	 * loaders: the GM page passes `entity.coverAssetId` straight through, and the players'
	 * page passes `coverImageId`, which `publicEntityBySlug` only fills in for an asset that
	 * already cleared the published/gm_only/revelation gate.
	 */
	import type { EntityType } from '@canonry/db/schema';
	import { COVER_POSITION, COVER_RATIO } from './cover-crop';

	let { src, alt, entityType }: { src: string; alt: string; entityType: EntityType } = $props();

	// Both maps moved to `cover-crop.ts` when O1 (#283) gave a cover its second surface, the
	// world home's Continue cards: rules 2 and 3 above are the same decision at both sizes.
	let ratio = $derived(COVER_RATIO[entityType]);
	let position = $derived(COVER_POSITION[entityType]);
</script>

<div
	class="mb-6 max-h-[20vh] w-full overflow-hidden rounded-md border border-line bg-panel-2"
	style="aspect-ratio: {ratio}"
>
	<img {src} {alt} class="h-full w-full object-cover" style="object-position: {position}" />
</div>
