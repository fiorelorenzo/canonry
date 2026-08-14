/**
 * C4 = C (docs/ux/DECISIONS.md): "in place, with a toggle" is the default, "the semantic
 * diff... already carries a sentence count per candidate, and that count decides which
 * layout a given diff gets, automatically, before the GM ever opens it." Past the
 * threshold, in-place has nothing coherent to toggle against a two-clause rewrite, so the
 * layout falls back to side-by-side (B) instead.
 */
import type { FactChange } from '@canonry/copilot';

export type DiffLayout = 'in-place' | 'side-by-side';

/** The artifact's own words: "past roughly two sentences changed in one paragraph, 'in
 * place' has nothing coherent to toggle against." A `changed` or `removed` fact change is
 * one sentence leaving the reading flow; an `added` one never had a "before" to toggle
 * against at all, so only the first two kinds count toward the threshold. */
const IN_PLACE_SENTENCE_THRESHOLD = 2;

export function diffLayoutFor(diff: FactChange[]): DiffLayout {
	const replacedOrRemoved = diff.filter(
		(change) => change.kind === 'changed' || change.kind === 'removed'
	).length;
	return replacedOrRemoved > IN_PLACE_SENTENCE_THRESHOLD ? 'side-by-side' : 'in-place';
}
