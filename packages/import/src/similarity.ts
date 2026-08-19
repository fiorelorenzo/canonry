/**
 * The one place in the repo that pairs a `SimilarityFn` with the threshold band measured for
 * it (issue #279).
 *
 * A band is a property of a score's distribution and not of the decision, so cosine and
 * trigram Jaccard do not share one: `MATCH_THRESHOLDS`' `newBelow` of 0.5 sits below the
 * lowest cosine the labelled corpus produces at all, which would make the "new" outcome
 * unreachable for the embedding scorer (matching.ts carries the numbers). That makes "which
 * band goes with which scorer" a real piece of knowledge, and knowledge written down twice is
 * exactly the shape issue #272 named for the budget constants: a private copy has no way to
 * notice when the value it is supposed to mirror changes.
 *
 * It was written down twice for a day. `apps/web/src/lib/server/onboarding.ts`'s
 * `resolveImportSimilarity` said `createEmbeddingSimilarity(...)` next to
 * `EMBEDDING_MATCH_THRESHOLDS`, and `packages/bench/src/e2e/import.ts` said the same two
 * things beside each other, and nothing connected them. `packages/bench`'s own guard on that
 * file could not see the difference, because it read the source text for an import statement
 * rather than asking what the harness actually resolves. Both callers now go through this
 * function, and both are checked by identity against the constants it returns.
 *
 * The scorer and the band come back together on purpose: a caller that can take one without
 * the other is a caller that can pair a cosine with a Jaccard band.
 */
import { lexicalTrigramSimilarity } from './lexical-similarity.js';
import { createEmbeddingSimilarity, type EmbeddingSimilarityDeps } from './embedding-similarity.js';
import {
	EMBEDDING_MATCH_THRESHOLDS,
	MATCH_THRESHOLDS,
	type MatchThresholds,
	type SimilarityFn
} from './matching.js';

export interface BandedSimilarity {
	similarity: SimilarityFn;
	/** The band measured for `similarity`, never a caller's choice. */
	thresholds: MatchThresholds;
	/** True when this is the non-semantic fallback. Derivable from `thresholds`, kept explicit
	 * because every caller that logs or reports which scorer ran wants to say so plainly, and
	 * comparing a threshold object to decide is the sort of thing that reads as an accident. */
	isLexical: boolean;
}

/**
 * The embedding scorer with its measured band when `deps` is present, the lexical scorer with
 * its own when `deps` is `null`.
 *
 * `null` is what a box with no `AI_GATEWAY_API_KEY` passes, and what a caller passes when
 * `model_config`'s `embedding` row cannot be resolved: SPEC.md §4 wants a good wiki with the
 * AI switched off, so matching degrades to the lexical scorer rather than failing the import.
 * The composition root above this decides which case it is in - reading credentials and
 * resolving a model is not this function's business, exactly as `resolveMatch` does not know
 * where its `similarity` came from.
 */
export function bandedSimilarity(deps: EmbeddingSimilarityDeps | null): BandedSimilarity {
	if (!deps) {
		return {
			similarity: lexicalTrigramSimilarity,
			thresholds: MATCH_THRESHOLDS,
			isLexical: true
		};
	}
	return {
		similarity: createEmbeddingSimilarity(deps),
		thresholds: EMBEDDING_MATCH_THRESHOLDS,
		isLexical: false
	};
}
