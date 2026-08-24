/**
 * Issue #378, decision R3, and the checklist R4 asks for (docs/design/DECISIONS.md "Round
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
 * "done" means here. Neither pointer's own table matters here, only whether it is set:
 * `imageStyleId` is what `pickStyle`'s cascade actually follows (packages/media/src/
 * style.ts), and `narrationStyleId` is what `loremasterVoiceInstruction`'s caller
 * resolves (packages/db/src/queries/narration.ts's `loremasterVoiceClauseForUniverse`) -
 * a universe pointed at either a shipped preset or its own custom row counts as done
 * either way, issue #451 having replaced the free-text `loremaster_description` column
 * this used to read a `.trim().length > 0` off. */
export function universeSetupItems(row: {
	imageStyleId: string | null;
	narrationStyleId: string | null;
}): UniverseSetupItem[] {
	return [
		{ id: 'imageStyle', done: row.imageStyleId !== null },
		{ id: 'loremasterVoice', done: row.narrationStyleId !== null }
	];
}
