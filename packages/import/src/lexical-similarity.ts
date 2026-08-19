/**
 * The lexical, non-semantic `SimilarityFn` (matching.ts): the fallback a box with no
 * embedding credentials scores entity matches with, and the baseline the matching
 * benchmark measures the real scorer against.
 *
 * It is not the production scorer. SPEC.md §6.4 is explicit that "string normalisation is
 * not enough" precisely because a translated name like "Il Ratto Dorato" shares almost no
 * structure with "the Gilded Rat" - this scorer inherits that near-blind spot (a
 * coincidental "rat"/"ratto" cognate keeps its score just above zero, well below every
 * genuine retitle/typo/abbreviation pair in the corpus), and matching-benchmark.test.ts
 * measures and reports it rather than hiding it.
 *
 * Character-trigram Jaccard rather than the whole-token overlap `nameOverlapScore` already
 * uses as a pre-filter in matching.ts, so the benchmark exercises a genuinely different
 * signal from the pre-filter it sits behind - trigrams also give partial credit for a typo
 * or an abbreviation sharing most of its substrings, which whole-token overlap does not.
 *
 * The real similarity function is `createEmbeddingSimilarity`
 * (embedding-similarity.ts): `@canonry/ai`'s embedding purpose plus a cosine distance.
 * `apps/web/src/lib/server/onboarding.ts`'s `resolveImportSimilarity` picks between the two
 * on one credential check (issue #279), and matching.ts and matching-benchmark.ts take
 * either as an injected parameter without caring which.
 */
import { normalizeForMatching } from './matching.js';
import type { MatchCandidate, MatchSubject, SimilarityFn } from './matching.js';

function trigrams(text: string): Set<string> {
	const padded = `  ${text} `;
	const grams = new Set<string>();
	for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
	return grams;
}

/** The lexical text for one side. Names and aliases only when `includeContext` is false,
 * which is what `lexicalTrigramSimilarity` ships as - see its own comment for the numbers
 * that decided it. */
function lexicalText(entity: MatchSubject | MatchCandidate, includeContext: boolean): string {
	const parts = [entity.name, ...entity.aliases];
	if (includeContext && entity.context) {
		const { type, summary, sourceSentence } = entity.context;
		for (const field of [type, summary, sourceSentence]) if (field) parts.push(field);
	}
	return normalizeForMatching(parts.join(' '));
}

/**
 * Jaccard similarity of character trigrams, in [0, 1], of whichever text `includeContext`
 * selects.
 *
 * The option exists because issue #310 had to answer "does the context that helps the
 * embedding scorer hurt this one" with a measurement rather than an assumption, and
 * `packages/bench`'s `matching-sweep` scores both instances over the same corpus to do it.
 * A factory rather than two copies of the trigram loop: the thing being compared is the text
 * each side is reduced to, and reimplementing the metric beside it would compare two
 * implementations instead.
 */
export function createLexicalTrigramSimilarity(
	options: { includeContext: boolean } = { includeContext: false }
): SimilarityFn {
	return (subject, candidate) => {
		const a = trigrams(lexicalText(subject, options.includeContext));
		const b = trigrams(lexicalText(candidate, options.includeContext));
		if (a.size === 0 || b.size === 0) return 0;
		let intersection = 0;
		for (const gram of a) if (b.has(gram)) intersection += 1;
		const union = a.size + b.size - intersection;
		return union === 0 ? 0 : intersection / union;
	};
}

/**
 * The shipped lexical scorer: names and aliases, no `MatchContext`.
 *
 * **Measured, not assumed (issue #310).** The context change that fixed the embedding
 * scorer's ordering was scored on this one too, over the same 24 pairs, and it makes it
 * worse in exactly the way character trigrams predict: two exports of one entity word their
 * summaries differently, so the union of trigrams grows faster than the intersection and every
 * true pair's score falls. Separation drops from 0.225 to 0.133, and at `MATCH_THRESHOLDS` the
 * scorer stops deciding anything at all: 0 of 13 true pairs matched and 12 false splits,
 * against 4 matched and 4 false splits on names alone. `matching-sweep` scores both texts on
 * every run, so this stays arguable rather than settled by this comment.
 *
 * So the fallback a box with no credentials resolves to is unchanged in both text and
 * behaviour, and `MATCH_THRESHOLDS` needs no re-derivation: it is still the band measured
 * for exactly this scorer.
 */
export const lexicalTrigramSimilarity: SimilarityFn = createLexicalTrigramSimilarity();
