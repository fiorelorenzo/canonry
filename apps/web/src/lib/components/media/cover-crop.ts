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
