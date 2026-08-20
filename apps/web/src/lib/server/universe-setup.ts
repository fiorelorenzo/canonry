/**
 * Issue #378, decision R3, and the checklist R4 asks for (docs/ux/DECISIONS.md "Round
 * thirteen"): "a setting is on the checklist when it changes what the product does and
 * has no sensible default." Today that is exactly two settings, both from this issue -
 * the universe's image style and its Loremaster voice - and this file is the one place
 * that decides what "incomplete" means for either of them. `ai_enabled` and
 * `propagation_cap` are deliberately absent: both have real defaults, and a default is
 * an answer, not a gap.
 *
 * A third setting joins the checklist by being added to `universeSetupItems`, never by a
 * second banner grown somewhere else - #379 (wave two) renders this list at the point of
 * use and once in the shell, and both surfaces read the same array so they can never
 * disagree about what is missing.
 */

export interface UniverseSetupItem {
	id: 'imageStyle' | 'loremasterVoice';
	done: boolean;
}

/** `row` is deliberately the narrow shape this needs, not the whole `universe` row - a
 * caller (a `+page.server.ts` load, #379's shell query) passes exactly the two columns
 * this reads, so a schema change elsewhere in `universe` can never silently change what
 * "done" means here. An `image_style` row with nothing pointing at it does not count:
 * `imageStyleId` is what `pickStyle`'s cascade actually follows (packages/media/src/
 * style.ts), so that is the one thing worth checking. A description of only whitespace
 * reads as unset for the same reason `loremaster_description`'s empty-string default
 * does - it would reach the prompt as nothing, so the checklist should say so too. */
export function universeSetupItems(row: {
	imageStyleId: string | null;
	loremasterDescription: string;
}): UniverseSetupItem[] {
	return [
		{ id: 'imageStyle', done: row.imageStyleId !== null },
		{ id: 'loremasterVoice', done: row.loremasterDescription.trim().length > 0 }
	];
}
