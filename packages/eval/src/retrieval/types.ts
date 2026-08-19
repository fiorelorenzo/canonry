/**
 * The retrieval eval harness (SPEC.md §11.3-§11.4, issue #63). A gold corpus of questions
 * with the chunks that should answer them, and a runner that reports MRR, recall at k and
 * the effect of the similarity threshold, so a change to top-k, the threshold or the
 * embedding model is a measurement rather than an argument (§11.4: "re-run that eval
 * before changing the embedding model").
 *
 * The retriever is injected exactly like the propagation harness's selector: this package
 * has no dependency on `packages/vector` or the indexing pipeline (issues #57 and #58, a
 * later wave). `topK` and `threshold` are runner parameters, not baked into the retriever,
 * because §11.4's numbers (top-k 8, threshold 0.5) are meant to be swept and re-measured,
 * not hard-coded into whatever produces the ranked hits.
 */

/** Mirrors the Qdrant payload fields of SPEC.md §11.3 that matter for an eval: the text
 * itself, its breadcrumb, and the keywords the extraction pass would attach for the
 * keyword boost §11.4 mentions. */
export interface GoldChunk {
	id: string;
	entitySlug: string;
	breadcrumb: string;
	text: string;
	keywords?: string[];
}

/** `relevantChunkIds` is ordered best-first: the first id is what MRR is scored against,
 * later ids still count for recall. */
export interface GoldQuestion {
	id: string;
	question: string;
	relevantChunkIds: string[];
}

export interface RetrievalCorpus {
	id: string;
	name: string;
	chunks: GoldChunk[];
	questions: GoldQuestion[];
}

export interface RetrievalHit {
	chunkId: string;
	score: number;
}

/** The seam: `packages/vector` plus the indexing pipeline (issues #57, #58) implement this
 * for real. Returns every hit it has an opinion about, ranked or not - the runner sorts,
 * thresholds and truncates to `topK` itself, so those two knobs can be swept without
 * touching the retriever. */
export type Retriever = (
	question: GoldQuestion,
	corpus: RetrievalCorpus
) => RetrievalHit[] | Promise<RetrievalHit[]>;

export interface RetrievalEvalOptions {
	/** SPEC.md §11.4: top-k 8. */
	topK?: number;
	/** SPEC.md §11.4: similarity threshold 0.5. */
	threshold?: number;
	/** Which k values to report recall-at-k for. Default covers 1 through `topK`. */
	recallAtKValues?: number[];
	/** Additional threshold values to sweep for the threshold-effect report, in addition
	 * to `threshold` itself. */
	thresholdSweep?: number[];
}

export interface RetrievalQuestionScore {
	questionId: string;
	/** 1-based rank of the first relevant chunk within the thresholded, top-k hits, or
	 * `null` when none of `relevantChunkIds` was returned. */
	rank: number | null;
	reciprocalRank: number;
	recallAtK: Record<number, number>;
	hitCount: number;
}

export interface ThresholdEffect {
	threshold: number;
	/** Mean recall at `topK` once hits below this threshold are dropped. */
	meanRecallAtTopK: number;
	/** Mean number of hits that survive the threshold, before the top-k cut. */
	meanResultCount: number;
	/**
	 * Mean number of hits inside the top-k window that are **not** in the question's
	 * `relevantChunkIds` - the noise a caller actually pays for, since top-k is what a
	 * reader or a model sees.
	 *
	 * `meanResultCount` above is the same count before the cut, and the two say different
	 * things once a corpus is large: on a 32-chunk corpus "survivors" and "what came back"
	 * are nearly the same list, on a 2000-chunk one the survivors can be in the hundreds
	 * while the window stays at eight (issue #278).
	 */
	meanIrrelevantInTopK: number;
}

export interface RetrievalReport {
	topK: number;
	threshold: number;
	mrr: number;
	recallAtK: Record<number, number>;
	thresholdEffect: ThresholdEffect[];
	questions: RetrievalQuestionScore[];
}
