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
 * Three derivations sit behind the two numbers below. The first (issue #125) measured the current
 * model, `alibaba/qwen3-embedding-4b`, against a purpose-built gold set and picked 0.25. The second
 * (issue #168) re-derived it against the 32-entity bilingual Valdoria Reach the product's own
 * `indexEntity` pipeline populates, moved it to 0.35, and **declined to touch top-k while recording
 * that recall kept climbing past 8**, on the reasoning that 32 chunks is too small a world for top-k
 * 8 (a quarter of it) to mean anything. The third (issue #278) checked that reasoning at
 * 2325 chunks and found it wrong.
 *
 * ## The corpus the third derivation used
 *
 * The bench universe's own 32 entities of canon plus a real community world, 78 CC BY-SA notes
 * indexed as a second `data_source` into the same collection: 2293 chunks, so 2325 in all, 72 times
 * issue #168's corpus and past SPEC.md §11.4's own 2044-chunk reference point. Same eighteen
 * `ASK_QUESTIONS`, same gold, so the added chunks are pure competition. Cosine scale on that corpus:
 * gold hits median 0.4744 (min 0.2010), everything else median 0.1906 with a p99 of 0.4151.
 *
 * ## Threshold: 0.35 confirmed, not moved
 *
 * | threshold | recall@8, 32 chunks | recall@8, 2325 chunks | admitted of 2325 | not-gold inside top-k |
 * | --- | --- | --- | --- | --- |
 * | 0.00 - 0.40 | **0.806**, flat | **0.750**, flat | 2311.61 -> 37.06 | 6.83 -> 5.72 |
 * | 0.45 | 0.704 | 0.656 | 10.94 | 3.86 |
 * | 0.50 | 0.611 | 0.617 | 3.40 | 1.89 |
 * | 0.55 | 0.500 | 0.500 | 1.54 | 0.88 |
 * | 0.60 | 0.250 | 0.250 | 0.72 | 0.33 |
 *
 * The flat band and the cliff are in exactly the same place at both corpus sizes, which is the
 * thing that was unmeasured: a wide low-threshold band was supposed to be a small corpus's luxury.
 * 0.35 keeps one measured step of margin below 0.40, the last flat point, the same discipline both
 * earlier derivations used rather than riding the edge, and it now trims a mean of 2311 surviving
 * candidates to 106. Unchanged.
 *
 * What did change is what the threshold is *for*. On 32 chunks it was the knob that decided how much
 * noise reached an answer; on 2325 it barely moves the window at all (6.83 not-gold hits at threshold
 * 0, 6.56 at 0.35) because top-k is doing that work. The threshold's job at real size is to keep the
 * candidate pool sane and to stay off the cliff.
 *
 * ## Top-k: 8 to 12
 *
 * At threshold 0.35 over the same eighteen questions, five repeats:
 *
 * | top-k | recall, 32 chunks | recall, 2325 chunks | same-language | cross-language | not-gold in window |
 * | --- | --- | --- | --- | --- | --- |
 * | 4 | 0.694 | 0.667 | 0.850 | 0.438 | 3.00 |
 * | 8 | 0.806 | 0.750 | 0.850 | 0.625 | 6.56 |
 * | **12** | **0.861** | **0.806** | **0.950** | 0.625 | 9.78 |
 * | 16 | 0.861 | 0.806 | 0.950 | 0.625 | 12.72 |
 * | 24 | 0.861 | 0.806 | 0.950 | 0.625 | 17.83 |
 * | 32 | 0.861 | 0.833 | 0.950 | 0.688 | 22.22 |
 * | 64 | 0.861 | 0.861 | 0.950 | 0.750 | 37.03 |
 *
 * **Recall still climbs past 8 on a corpus where top-k 8 returns 0.34 per cent of the world, not a
 * quarter of it.** Issue #168's stated reason for leaving top-k alone was that the climb is a
 * property of a 32-chunk fixture; two orders of magnitude of corpus later the climb is still there,
 * so that reason does not hold and top-k 8 needs a different one. There is not one: it caps recall.
 *
 * 12 rather than 16 or 32 because 12 is where the curve stops paying. It is the last point that buys
 * anything (16 and 24 buy exactly nothing at either corpus size), and it is where the same-language
 * subset reaches its own ceiling of 0.950 - the point at which retrieval stops failing on questions
 * asked in the language their answer is written in. Everything past it is cross-language tail that
 * needs k=32 or k=64 to move, at three to five times the sources, which is a ranking problem
 * (`docs/eval.md`'s cross-language entries) and not a top-k one.
 *
 * **What raising it costs, stated rather than buried.** The window grows from a mean 7.7 hits to
 * 11.0, of which the not-gold count goes from 6.56 to 9.78: every Ask answer carries about three more
 * sources that do not answer the question, on top of `ask.ts`'s six own-canon sources. MRR is
 * unmoved (0.641 at k=8, 0.647 at k=12), so the top of the list is the same list - the four extra
 * slots are tail, and tail is exactly where the two recovered gold entries were. The gain is two gold
 * entries out of 36 gold question-entity pairs, reproducible with zero spread over five query repeats
 * and two independent corpus embeddings, and it is thin enough to name: a judged Ask run that shows
 * answer quality flat or worse at 12 would be grounds to put it back to 8, and that measurement does
 * not exist yet.
 *
 * ## What this corpus cannot say
 *
 * The 2293 added chunks are a *different world*, which makes them weaker competition than more of the
 * same world would be: non-gold cosine median falls from 0.3040 on the 32-chunk corpus to 0.1906 here,
 * and the non-gold p99 from 0.5573 to 0.4151, because a question about the Valdoria Watch is further
 * from a page about Architect ruins than from another Valdoria entry. So this measures "a large
 * indexed source does not break the threshold", which was the open question, and does not measure a
 * universe with two thousand chunks of its **own** canon crowding the boundary. That one needs a
 * corpus nobody has yet.
 *
 * The previous threshold before 0.35, 0.55, was calibrated for `gemini-embedding-001`, whose noise
 * floor alone sat there. Against this model 0.55 is above the median relevant score in both
 * languages: shipping the model change without re-deriving this would have discarded most correct
 * hits and looked like a retrieval quality problem rather than a constant left behind.
 */
export const DEFAULT_TOP_K = 12;
export const DEFAULT_THRESHOLD = 0.35;

/**
 * How much each matched keyword adds to a hit's cosine score, meant to nudge ranking among close
 * hits rather than override similarity.
 *
 * **Measured (issue #278), and the specific risk this comment used to name does not happen.** The
 * fear was arithmetic: 0.03 was chosen against a nominal [0, 1] cosine range, `qwen3-embedding-4b`
 * separates a relevant chunk from an unrelated one by about 0.19, so six matched keywords would be
 * worth the whole semantic signal and a chunk could win on vocabulary alone. Swept over the
 * 2325-chunk corpus described above, at the shipped top-k and threshold:
 *
 * | per match | recall | MRR | not-gold in window | hits the boost promoted into it | largest boost applied |
 * | --- | --- | --- | --- | --- | --- |
 * | 0 (pure cosine) | 0.694 | 0.651 | 6.67 | 0.00 | 0.000 |
 * | 0.01 | 0.694 | 0.650 | 6.67 | 0.22 | 0.030 |
 * | 0.02 | 0.750 | 0.646 | 6.56 | 0.61 | 0.060 |
 * | **0.03** | **0.750** | **0.641** | **6.56** | **0.83** | **0.090** |
 * | 0.05 | 0.806 | 0.625 | 6.50 | 1.17 | 0.150 |
 * | 0.08 | 0.778 | 0.618 | 6.56 | 1.94 | 0.240 |
 * | 0.12 | 0.778 | 0.604 | 6.56 | 2.61 | 0.360 |
 *
 * Six matches never happened. The most any hit matched was three keywords, so the largest boost the
 * shipped value ever applied was 0.090 against a gold-versus-other median gap of 0.283 on that
 * corpus - under a third of the separation, which is a nudge. It stays at 0.03 on that basis, and
 * the boost earns its place: 0.03 beats pure cosine by 0.056 recall for 0.010 of MRR.
 *
 * **0.05 is the row worth reading twice, and I am not taking it.** It scores 0.056 more recall
 * again, but its largest applied boost is 0.150, over half the separation, and the recall peak is
 * not monotonic - 0.08 and 0.12 fall back. On 36 gold question-entity pairs a 0.056 step is two
 * pairs, so that peak is as likely to be this corpus as a real optimum, and paying for it means
 * letting vocabulary overlap carry half the weight of meaning.
 *
 * **The caveat that would reopen this.** The match count is bounded by what the extractor writes:
 * `heuristicExtractor` keeps the eight most frequent non-stopword terms of a chunk, and a short
 * question overlaps at most three of them. `createGatewayExtractor` has no such bound (its
 * `excerptKeywords` is an unbounded `z.array(z.string())`) and nothing in production wires it today.
 * The first deployment that does needs this sweep re-run, because the arithmetic above is a fact
 * about the keyword sets, not about the constant.
 */
export const KEYWORD_BOOST_PER_MATCH = 0.03;

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

/**
 * How many of `keywords` the query text matches. Exported because a sweep needs the match
 * count itself to re-score a cached hit list at several `perMatch` values without a second
 * copy of this tokenising and matching (`packages/bench`'s `retrieval-sweep`, issue #278),
 * and because the count is the thing worth asserting in a test: the boost is that count
 * times a constant.
 */
export function keywordMatchCount(queryText: string, keywords: string[]): number {
	return matchesIn(queryTermsOf(queryText), keywords);
}

function matchesIn(queryTerms: Set<string>, keywords: string[]): number {
	let matches = 0;
	for (const keyword of keywords) {
		if (queryTerms.has(keyword.toLowerCase())) matches += 1;
	}
	return matches;
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
	/**
	 * What one matched keyword adds to a hit's cosine score. Defaults to the shipped
	 * `KEYWORD_BOOST_PER_MATCH`, and the production retriever below never passes it: it
	 * exists so `packages/bench`'s `retrieval-sweep` can pull an unboosted, pure-cosine hit
	 * list (issue #278) and re-score it locally per sweep point, the same way `topK` and
	 * `threshold` are runner parameters rather than baked-in constants.
	 */
	keywordBoostPerMatch?: number;
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
	const perMatch = options.keywordBoostPerMatch ?? KEYWORD_BOOST_PER_MATCH;
	return hits
		.map((hit) => ({
			chunkId: hit.id,
			score: hit.score + matchesIn(queryTerms, hit.payload.excerptKeywords) * perMatch,
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
