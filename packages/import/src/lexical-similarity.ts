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

function subjectText(subject: MatchSubject): string {
	return normalizeForMatching([subject.name, ...subject.aliases].join(' '));
}

function candidateText(candidate: MatchCandidate): string {
	return normalizeForMatching([candidate.name, ...candidate.aliases].join(' '));
}

/** Jaccard similarity of character trigrams, in [0, 1]. */
export const lexicalTrigramSimilarity: SimilarityFn = (subject, candidate) => {
	const a = trigrams(subjectText(subject));
	const b = trigrams(candidateText(candidate));
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const gram of a) if (b.has(gram)) intersection += 1;
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
};
