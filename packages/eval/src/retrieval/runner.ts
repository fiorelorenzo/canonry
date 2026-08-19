import type {
	GoldQuestion,
	RetrievalCorpus,
	RetrievalEvalOptions,
	RetrievalHit,
	RetrievalQuestionScore,
	RetrievalReport,
	Retriever,
	ThresholdEffect
} from './types.js';

const DEFAULT_TOP_K = 8;
const DEFAULT_THRESHOLD = 0.5;

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sortedByScoreDesc(hits: RetrievalHit[]): RetrievalHit[] {
	return [...hits].sort((a, b) => b.score - a.score);
}

function recallAt(hits: RetrievalHit[], relevant: string[], k: number): number {
	if (relevant.length === 0) return 1;
	const window = new Set(hits.slice(0, k).map((h) => h.chunkId));
	return relevant.filter((id) => window.has(id)).length / relevant.length;
}

function scoreQuestion(
	question: GoldQuestion,
	rawHits: RetrievalHit[],
	topK: number,
	threshold: number,
	recallAtKValues: number[]
): RetrievalQuestionScore {
	const sorted = sortedByScoreDesc(rawHits);
	const thresholded = sorted.filter((hit) => hit.score >= threshold);
	const topKHits = thresholded.slice(0, topK);

	const relevantSet = new Set(question.relevantChunkIds);
	const rankIndex = topKHits.findIndex((hit) => relevantSet.has(hit.chunkId));
	const rank = rankIndex === -1 ? null : rankIndex + 1;

	const recallAtK: Record<number, number> = {};
	for (const k of recallAtKValues) {
		recallAtK[k] = recallAt(thresholded, question.relevantChunkIds, k);
	}

	return {
		questionId: question.id,
		rank,
		reciprocalRank: rank === null ? 0 : 1 / rank,
		recallAtK,
		hitCount: thresholded.length
	};
}

function computeThresholdEffect(
	corpus: RetrievalCorpus,
	hitsByQuestion: Map<string, RetrievalHit[]>,
	topK: number,
	thresholds: number[]
): ThresholdEffect[] {
	return thresholds.map((t) => {
		const recalls: number[] = [];
		const counts: number[] = [];
		const irrelevant: number[] = [];
		for (const question of corpus.questions) {
			const sorted = sortedByScoreDesc(hitsByQuestion.get(question.id) ?? []);
			const filtered = sorted.filter((hit) => hit.score >= t);
			recalls.push(recallAt(filtered, question.relevantChunkIds, topK));
			counts.push(filtered.length);
			const relevant = new Set(question.relevantChunkIds);
			irrelevant.push(filtered.slice(0, topK).filter((hit) => !relevant.has(hit.chunkId)).length);
		}
		return {
			threshold: t,
			meanRecallAtTopK: mean(recalls),
			meanResultCount: mean(counts),
			meanIrrelevantInTopK: mean(irrelevant)
		};
	});
}

/**
 * Runs every question in `corpus` through `retriever` and reports MRR, recall at k, and
 * the effect of sweeping the similarity threshold. Never touches a model or Qdrant:
 * `retriever` is the only thing it calls, which is what lets a deliberately bad stub
 * (returns nothing, returns everything unranked) and a deliberately good one (returns the
 * gold chunks first) both be exercised in a unit test - see `test/retrieval-runner.
 * test.ts`.
 */
export async function runRetrievalEval(
	corpus: RetrievalCorpus,
	retriever: Retriever,
	options: RetrievalEvalOptions = {}
): Promise<RetrievalReport> {
	const topK = options.topK ?? DEFAULT_TOP_K;
	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const recallAtKValues =
		options.recallAtKValues ?? [...new Set([1, 3, 5, topK])].sort((a, b) => a - b);
	const sweepThresholds = [...new Set([threshold, ...(options.thresholdSweep ?? [])])].sort(
		(a, b) => a - b
	);

	const hitsByQuestion = new Map<string, RetrievalHit[]>();
	const questions: RetrievalQuestionScore[] = [];
	for (const question of corpus.questions) {
		const rawHits = await retriever(question, corpus);
		hitsByQuestion.set(question.id, rawHits);
		questions.push(scoreQuestion(question, rawHits, topK, threshold, recallAtKValues));
	}

	const recallAtK: Record<number, number> = {};
	for (const k of recallAtKValues) {
		recallAtK[k] = mean(questions.map((q) => q.recallAtK[k] ?? 0));
	}

	return {
		topK,
		threshold,
		mrr: mean(questions.map((q) => q.reciprocalRank)),
		recallAtK,
		thresholdEffect: computeThresholdEffect(corpus, hitsByQuestion, topK, sweepThresholds),
		questions
	};
}
