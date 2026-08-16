/**
 * Retrieval (SPEC.md §11.4): "top-k 8 and a similarity threshold of 0.5... keyword boost
 * from the extracted excerptKeywords". Issue #62's exclusion list is honoured here too -
 * every call resolves the universe's current exclusion patterns from the database, so a
 * newly-added exclusion takes effect on the very next query with no re-index required
 * ("disappears from retrieval within one deploy").
 */
import type { Db } from '@canonry/db';
import { listExclusionPatternsForUniverse, supersededUrlsForUniverse } from '@canonry/db';
import { queryLore, type LoreChunkPayload, type QdrantClient } from '@canonry/vector';

/**
 * SPEC.md §11.4 quotes top-k 8 and a threshold of 0.5, measured against a 2044-chunk gold corpus at
 * MRR 0.775. That number came from research, with a **hashing embedder** behind it, and it has now
 * survived two model changes it was never valid across. **A threshold does not transfer between
 * embedding models.** It is a property of one model's cosine scale, and treating it as a constant of
 * the product is how retrieval breaks without anything failing.
 *
 * Current model, `alibaba/qwen3-embedding-4b` (issue #125, chosen in `models.ts`), measured on the
 * Valdoria Reach gold corpus through the live gateway, 20 questions in each language over 15 chunks:
 *
 * | | relevant pairs | unrelated pairs |
 * | --- | --- | --- |
 * | English questions | min 0.3105, median 0.5249 | median 0.3186, p99 0.6280 |
 * | Italian questions | min 0.2372, median 0.4625 | median 0.2560, p99 0.5195 |
 *
 * That derivation picked 0.25. Issue #168 re-derived it a second time, against a corpus Ask
 * actually queries rather than a purpose-built gold set: the 32-entity bilingual Valdoria Reach the
 * canon-save-job worker's own `indexEntity` pipeline indexes (`packages/bench`'s
 * `pnpm --filter @canonry/bench retrieval-sweep`, `@canonry/eval`'s `runRetrievalEval` swept over
 * `thresholdSweep`, real embeddings, real Qdrant, all eighteen `ASK_QUESTIONS`). Mean recall at the
 * shipped top-k of 8:
 *
 * | threshold | recall@8 | mean hits admitted (of 32) |
 * | --- | --- | --- |
 * | 0.00 - 0.40 | **0.806**, flat | 32.00 -> 6.94 |
 * | 0.45 | 0.722 | 4.06 |
 * | 0.50 | 0.611 | 2.17 |
 * | 0.55 | 0.500 | 1.39 |
 * | 0.60 | 0.250 | 0.72 |
 * | 0.65 | 0.194 | 0.44 |
 *
 * Recall is completely flat from 0 through 0.40 - every threshold in that range keeps exactly the
 * same answers, so the choice inside it is pure noise-cutting with no recall cost, and the cliff
 * sits between 0.40 and 0.45. **0.25 survives** (it costs nothing) **but was not the best available
 * point**: it only trims 32 candidates to a mean of 24.78, most of a 32-chunk world. 0.35, one
 * measured step below the cliff (the same margin-below-the-edge the first derivation used, never
 * the tightest point), trims to a mean of 11.50 - more than twice the noise cut of 0.25, for zero
 * measured recall cost. Raised to 0.35 on that basis.
 *
 * **Top-k stays at 8, not because the measurement found nothing - it found the opposite.** Sweeping
 * top-k at threshold 0.25 over the same eighteen questions: recall@k 0.806 at k=8, 0.889 at k=16,
 * 0.944 at k=24 and 32 - top-k 8 of a 32-chunk world visibly caps recall on *this* corpus, and the
 * cross-language subset alone is worse hit: 0.625 at k=8 against 0.875 at k=32 (`docs/eval.md`'s
 * 2026-08-16 entry carries the full breakdown), because a correct cross-language match tends to
 * rank behind same-language false positives on a corpus that chunks one entity into one
 * whole-body vector. That is a real effect, but it is a property of *this bench corpus's size*
 * (32 chunks total, so top-k 8 already returns a quarter of the world) rather than of the model or
 * the threshold, and it will not hold in a universe with hundreds of chunks the way this bench's
 * own 32 do not resemble SPEC.md §11.4's 2044-chunk corpus either. Raising the shipped default to
 * chase a 32-chunk toy world's ceiling would mean every real Ask answer in every universe, of any
 * size, carries twice the sources for a benefit this measurement cannot show holds anywhere but
 * here. Re-run this sweep once a universe with own-canon plus an imported wiki source exists to
 * measure top-k against a corpus of realistic size, and revisit then.
 *
 * The previous value before this one, 0.55, was calibrated for `gemini-embedding-001`, whose noise
 * floor alone sat there. Against this model 0.55 is above the median relevant score in both
 * languages: shipping the model change without re-deriving this would have discarded most correct
 * hits and looked like a retrieval quality problem rather than a constant left behind.
 */
export const DEFAULT_TOP_K = 8;
export const DEFAULT_THRESHOLD = 0.35;

/**
 * How much each matched keyword adds to a hit's cosine score, meant to nudge ranking among close
 * hits rather than override similarity.
 *
 * **Unverified against the current model, and the risk is not theoretical.** 0.03 was chosen
 * against a nominal [0, 1] cosine range, but `qwen3-embedding-4b` separates a relevant chunk from
 * an unrelated one by about 0.19 on our gold corpus, so six matched keywords would be worth the
 * entire signal and a chunk could win on vocabulary alone. Nothing measures that today: the model
 * comparison in `models.ts` scored pure cosine, with this boost out of the path.
 *
 * Left as it is rather than guessed downward, because a number changed without a measurement is
 * how the threshold above ended up wrong. Whoever exercises the boost through
 * `packages/eval`'s harness should size it against the separation it is nudging inside.
 */
const KEYWORD_BOOST_PER_MATCH = 0.03;

export interface RetrievalHit {
	chunkId: string;
	score: number;
	payload: LoreChunkPayload;
}

function queryTermsOf(queryText: string): Set<string> {
	// Unicode-aware on purpose: `[a-z0-9]+` silently dropped every accented word, so an Italian
	// question ("perché", "città") lost its keyword boost entirely while an English one kept it.
	// SPEC.md §17 says the copilot works in both languages; a tokeniser that only sees ASCII is
	// that promise failing quietly rather than loudly.
	return new Set(queryText.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function keywordBoost(queryTerms: Set<string>, keywords: string[]): number {
	let matches = 0;
	for (const keyword of keywords) {
		if (queryTerms.has(keyword.toLowerCase())) matches += 1;
	}
	return matches * KEYWORD_BOOST_PER_MATCH;
}

export interface ScoreLoreHitsOptions {
	db: Db;
	vectorClient: QdrantClient;
	collectionName: string;
	universeId: string;
	queryVector: number[];
	/** Raw query text, for the keyword boost - matched against each hit's
	 * `excerptKeywords`. */
	queryText: string;
	/** How many raw vector-search results to pull before boosting and sorting. Larger
	 * than `topK` because the keyword boost can promote a hit past the cosine-only
	 * ranking's cutoff. */
	candidateLimit?: number;
	/**
	 * SPEC.md §4.1, issue #19: whose exclusion and supersede rules govern this read.
	 * Defaults to `universeId`, which is right for a universe reading its own indexed
	 * corpus. A derived universe reading its *base* universe's collection instead passes
	 * `universeId: baseUniverseId` (so the Qdrant filter matches where those chunks were
	 * indexed) and `policyUniverseId: derivedUniverseId` (so the declarations the GM
	 * actually made - "this page is superseded" - are the ones that apply, even though
	 * they live under a different universe id than the collection being read).
	 */
	policyUniverseId?: string;
}

/**
 * Every scored, exclusion-filtered hit the universe has, boosted by keyword overlap and
 * sorted best-first - unfiltered by threshold or top-k, so a caller (the production
 * retriever below, or an eval harness sweeping those two knobs) applies its own cutoff.
 */
export async function scoreLoreHits(options: ScoreLoreHitsOptions): Promise<RetrievalHit[]> {
	const policyUniverseId = options.policyUniverseId ?? options.universeId;
	const [exclusionPatterns, supersededUrls] = await Promise.all([
		listExclusionPatternsForUniverse(options.db, policyUniverseId),
		supersededUrlsForUniverse(options.db, policyUniverseId)
	]);
	// Exact urls match `urlMatchesPattern` as a literal (no `*` to expand), so a
	// superseded page rides the same filter an exclusion pattern already uses - no second
	// filtering mechanism to build or keep in sync with the first.
	const excludedUrlPatterns = [...exclusionPatterns, ...supersededUrls];
	const hits = await queryLore(options.vectorClient, options.collectionName, {
		vector: options.queryVector,
		universeId: options.universeId,
		excludedUrlPatterns,
		limit: options.candidateLimit ?? DEFAULT_TOP_K * 4
	});

	const queryTerms = queryTermsOf(options.queryText);
	return hits
		.map((hit) => ({
			chunkId: hit.id,
			score: hit.score + keywordBoost(queryTerms, hit.payload.excerptKeywords),
			payload: hit.payload
		}))
		.sort((a, b) => b.score - a.score);
}

export interface RetrieveForUniverseOptions extends ScoreLoreHitsOptions {
	topK?: number;
	threshold?: number;
}

/** The production entry point: scored hits, thresholded and truncated to top-k, with
 * issue #62's exclusions already applied inside `scoreLoreHits`. */
export async function retrieveForUniverse(
	options: RetrieveForUniverseOptions
): Promise<RetrievalHit[]> {
	const topK = options.topK ?? DEFAULT_TOP_K;
	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const scored = await scoreLoreHits({
		...options,
		candidateLimit: options.candidateLimit ?? topK * 4
	});
	return scored.filter((hit) => hit.score >= threshold).slice(0, topK);
}
