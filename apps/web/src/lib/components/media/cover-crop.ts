/**
 * O2 (#284) decided how a cover is cropped by entity type - wide for a place, closer to
 * square for a person, positioned rather than stretched - and O1 (#283) gave a cover a
 * second place to appear: the world home's Continue cards. Round twelve's Q5 re-derives
 * the table, because O2's own words were false: `3 / 2` for a character is a landscape,
 * and no entity type was portrait at all.
 *
 * Both maps live here rather than inside `EntryCover.svelte` so the two surfaces cannot
 * disagree about where a portrait keeps its face. A card thumbnail is a fixed-height strip
 * and so has no use for `COVER_RATIO`, but `COVER_POSITION` is exactly the same decision at
 * a smaller size, and duplicating it would be a second answer to one question.
 */
import type { EntityType } from '@canonry/db/schema';

/**
 * The shape a cover has, stated once, in the provider's own `aspect_ratio` notation
 * because that is the form a generation has to be asked for in.
 *
 * **This is the table, and `COVER_RATIO` below is derived from it.** Q5's constraint is
 * that the shape a cover is generated at and the shape it is displayed at must not differ:
 * if they do, the picture arrives pre-cropped wrong and `object-position` cannot undo a
 * crop the model already made. One table read by both the CSS and the generate request is
 * how that is guaranteed structurally rather than by two constants agreeing today.
 *
 * Portrait for a character and an item, which are read as a subject; `3:4` rather than
 * `2:3` because O2 asked for "closer to square for a person" and a face at 2:3 spends its
 * height on a torso. `4:3` for a faction, which is a sigil or a banner and sits between the
 * two. Wide for a place, an event and a session, all three read as somewhere or something
 * that happened.
 *
 * **A place is `16:9` and not the `21 / 9` it used to display at, and that is the same
 * constraint rather than a taste change.** `prunaai/p-image`, the model the `portrait` row
 * runs on, has no `21:9` in its enum (see IMAGE_MODEL_ASPECT_RATIOS in @canonry/media), so
 * a 21/9 band could only ever be a crop of something else. Displaying a shape nothing can
 * generate is what this table exists to stop.
 */
export const COVER_ASPECT_RATIO: Record<EntityType, string> = {
	character: '3:4',
	item: '3:4',
	faction: '4:3',
	place: '16:9',
	event: '16:9',
	session: '16:9'
};

/** Every distinct shape a cover can be asked for, which is what /admin/models has to check
 * a candidate model against: a row is saved for a feature, not for one entity type, so the
 * question a save answers is "can this model draw every shape this feature will ask it
 * for". */
export const COVER_ASPECT_RATIOS: readonly string[] = [
	...new Set(Object.values(COVER_ASPECT_RATIO))
];

function toCssRatios<T extends string>(source: Record<T, string>): Record<T, string> {
	const out = {} as Record<T, string>;
	for (const key of Object.keys(source) as T[]) out[key] = source[key].replace(':', ' / ');
	return out;
}

/** The same table in CSS's own notation, for `aspect-ratio`. Derived, never written by
 * hand: a second literal here is exactly the disagreement Q5 is about. */
export const COVER_RATIO: Record<EntityType, string> = toCssRatios(COVER_ASPECT_RATIO);

/**
 * Round fourteen S5 (#410), which repeals round thirteen R1 (#376) and #399's amendment of
 * it: every cover goes to the top of the aside (`EntrySections.svelte`), whatever its
 * ratio, not just the ones taller than they are wide. There is no longer a second place a
 * cover can stand, so there is no placement to derive from the ratio table any more -
 * `coverPlacement`, `CoverPlacement` and `coverFigureStyle` are gone with it, and so is
 * `+page.svelte`'s header grid that used to keep the figure column's width and this
 * module's `COVER_FIGURE_WIDTH` from drifting apart.
 *
 * What replaces `coverFigureStyle` is `coverAsideStyle` below: the aside is `md:w-64`
 * already, so a cover mounted inside it takes that width for free, by being a plain block
 * element with nothing narrower declared. Only the ratio needs stating.
 */

/**
 * O2's cap and the type's own shape, in one style string, used only by the band now: the
 * mobile-only strip above the title, shown below `md` where the aside is a sheet the reader
 * has to open (round fourteen S5, #410) rather than a place the page's own picture belongs.
 *
 * **The cap and the ratio used to be in conflict, and the cap always won.** The band was
 * `w-full max-h-[20vh]` plus `aspect-ratio`, which forces the width, derives a height from
 * it and then clips that height at a fifth of the screen: on a 1440x900 window every cover
 * drew 784x180, a 4.36:1 strip, whatever `COVER_RATIO` said. So a portrait was displayed as
 * a landscape however it had been generated, which is the second half of the same defect Q5
 * names and the reason "no `object-position` saves it".
 *
 * Sizing by height instead keeps both promises: the width is the largest the ratio allows
 * inside a 20vh-tall box, clamped to the column, and the height follows from the used width
 * rather than being clipped. The picture is never cropped by the layout, so `object-cover`
 * only ever has an uploaded file's own shape to reconcile.
 */
export function coverBandStyle(entityType: EntityType): string {
	const [width, height] = COVER_ASPECT_RATIO[entityType].split(':').map(Number);
	if (!width || !height) throw new Error(`COVER_ASPECT_RATIO[${entityType}] is not a ratio`);
	return `aspect-ratio: ${COVER_RATIO[entityType]}; width: calc(20vh * ${width / height}); max-width: 100%`;
}

/**
 * The aside's own cover, `md` and up: no cap, no fixed width, just the ratio. The aside
 * column (`md:w-64` in `EntrySections.svelte`) already decides the width, so stating one
 * here too would be the second-answer problem `coverFigureStyle` used to have with
 * `+page.svelte`'s header grid, restated rather than fixed. Height follows from whatever
 * width the aside actually renders at - "natural height per ratio", the decision's own
 * words - tall for a character, short for a place, with nothing here to disagree.
 */
export function coverAsideStyle(entityType: EntityType): string {
	return `aspect-ratio: ${COVER_RATIO[entityType]}`;
}

/**
 * A character's band keeps the top of the picture, everything else keeps the middle.
 * Nothing is ever squashed to fit.
 *
 * Q5 asked whether `center top` on a character was only compensating for a landscape crop
 * of a face, and half of it was: a generated cover is now drawn at the band's own shape, so
 * `object-cover` crops nothing at all and the position does not apply to it. What survives
 * is the other half. An uploaded or imported file is whatever shape its author made it, and
 * O1's Continue cards crop every cover into a fixed-height strip whatever its ratio, so a
 * tall photograph of a person is still being cut somewhere. Cutting it at the feet rather
 * than through the head is the right default, and it costs a generated cover nothing.
 */
export const COVER_POSITION: Record<EntityType, string> = {
	character: 'center top',
	item: 'center',
	faction: 'center',
	place: 'center',
	event: 'center',
	session: 'center'
};

/**
 * Round eleven P6, which reverses O2 narrowly: an entry with no cover shows a placeholder
 * to somebody who can write to that world, and nothing at all to anybody else. O2's own
 * reason survives in the third branch, so it is worth stating as the whole answer rather
 * than as two conditions on a page: a reader is never shown an invitation they cannot
 * accept.
 *
 * This is a function and not an `{#if}` on the page because the second argument is a
 * permission, resolved on the server (`media.canWrite`, which is `role !== 'viewer'`), and
 * a gate written inline is a gate the next refactor of that markup can drop without any
 * test noticing. `cover-gate.test.ts` covers the matrix, including the case that matters:
 * `canWrite: false` with no cover is `'none'`, never `'placeholder'`.
 */
export function coverSlot(input: {
	coverAssetId: string | null;
	canWrite: boolean;
}): 'band' | 'placeholder' | 'none' {
	if (input.coverAssetId) return 'band';
	return input.canWrite ? 'placeholder' : 'none';
}
