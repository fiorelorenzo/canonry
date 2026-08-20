/**
 * O2 (#284) decided how a cover is cropped by entity type - wide for a place, closer to
 * square for a person, positioned rather than stretched - and O1 (#283) gave a cover a
 * second place to appear: the world home's Continue cards.
 *
 * Both maps live here rather than inside `EntryCover.svelte` so the two surfaces cannot
 * disagree about where a portrait keeps its face. A card thumbnail is a fixed-height strip
 * and so has no use for `COVER_RATIO`, but `COVER_POSITION` is exactly the same decision at
 * a smaller size, and duplicating it would be a second answer to one question.
 */
import type { EntityType } from '@canonry/db/schema';

/** Wide for a place, an event or a session, since all three are read as somewhere or
 * something that happened; closer to square for a character or an item, which are read as a
 * subject; a faction's sigil or banner sits between the two. */
export const COVER_RATIO: Record<EntityType, string> = {
	character: '3 / 2',
	item: '3 / 2',
	faction: '16 / 9',
	place: '21 / 9',
	event: '21 / 9',
	session: '21 / 9'
};

/** A character's band keeps the top of the picture, because that is where a face is, and
 * everything else keeps the middle. Nothing is ever squashed to fit. */
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
