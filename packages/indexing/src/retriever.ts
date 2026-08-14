/**
 * Retrieval (SPEC.md §11.4): "top-k 8 and a similarity threshold of 0.5... keyword boost
 * from the extracted excerptKeywords". Issue #62's exclusion list is honoured here too -
 * every call resolves the universe's current exclusion patterns from the database, so a
 * newly-added exclusion takes effect on the very next query with no re-index required
 * ("disappears from retrieval within one deploy").
 */
import type { Db } from '@canonry/db';
import { listExclusionPatternsForUniverse } from '@canonry/db';
import { queryLore, type LoreChunkPayload, type QdrantClient } from '@canonry/vector';

/** SPEC.md §11.4: measured against a 2044-chunk gold corpus, MRR 0.775 - not guesses,
 * and not to be changed without re-running the eval (packages/eval's retrieval harness).
 */
export const DEFAULT_TOP_K = 8;
export const DEFAULT_THRESHOLD = 0.5;

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
	return new Set(queryText.toLowerCase().match(/[a-z0-9]+/g) ?? []);
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
}

/**
 * Every scored, exclusion-filtered hit the universe has, boosted by keyword overlap and
 * sorted best-first - unfiltered by threshold or top-k, so a caller (the production
 * retriever below, or an eval harness sweeping those two knobs) applies its own cutoff.
 */
export async function scoreLoreHits(options: ScoreLoreHitsOptions): Promise<RetrievalHit[]> {
	const excludedUrlPatterns = await listExclusionPatternsForUniverse(
		options.db,
		options.universeId
	);
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
