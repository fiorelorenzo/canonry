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

/** SPEC.md §11.4 quotes top-k 8 and a 0.5 threshold, and those were measured against a
 * 2044-chunk gold corpus at MRR 0.775 - with the **hashing embedder**. Issue #125 replaced it
 * with a real multilingual model (`google/gemini-embedding-001`), and that moves both numbers,
 * because a real embedder's cosine range is nothing like a token-overlap hash's.
 *
 * Measured on the fixture world (5 chunks, 8 questions, half of them Italian against English
 * prose) through the live gateway: correct pairs 0.5882 to 0.7981, unrelated pairs 0.4896 to
 * 0.6680, and the right chunk ranked first 8 times out of 8. Two consequences, both load-bearing:
 *
 * 1. ranking is what works, thresholding barely discriminates. The distributions overlap, so no
 *    threshold separates relevant from irrelevant on this model. The threshold is a noise floor,
 *    not a relevance test, and reading it as one is how retrieval quietly gets worse.
 * 2. 0.5 was nearly a no-op here (it cut nothing above the 0.4896 floor) and anything above
 *    0.5882 started dropping correct answers. 0.55 sits between the two with the whole correct
 *    set intact.
 *
 * This is a 5-chunk smoke calibration, not the gold corpus. The 2044-chunk eval has to be
 * re-run against the real embedder before either number is quotable again, which is what
 * packages/eval's retrieval harness is for.
 */
export const DEFAULT_TOP_K = 8;
export const DEFAULT_THRESHOLD = 0.55;

/** How much each matched keyword adds to a hit's cosine score. Small relative to the
 * [0, 1] cosine range so the boost nudges ranking among close hits rather than
 * overriding vector similarity outright. */
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
