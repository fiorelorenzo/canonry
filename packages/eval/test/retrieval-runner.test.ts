import { describe, expect, it } from 'vitest';
import { runRetrievalEval } from '../src/retrieval/runner.js';
import { valdoriaReachRetrieval } from '../src/retrieval/corpus/index.js';
import type { Retriever } from '../src/retrieval/types.js';

/** Returns the gold chunks first, highest-scored, everything else below threshold. The
 * retriever the harness has to score well, since it is what "matches the gold corpus"
 * looks like. */
const goodRetriever: Retriever = (question, corpus) => {
	const relevantIndex = new Map(question.relevantChunkIds.map((id, i) => [id, i]));
	return corpus.chunks.map((chunk) => {
		const rank = relevantIndex.get(chunk.id);
		return { chunkId: chunk.id, score: rank === undefined ? 0.1 : 1 - rank * 0.01 };
	});
};

/** Never returns a hit. Worst possible recall and MRR. */
const emptyRetriever: Retriever = () => [];

/** Scores every chunk by its fixed position in the corpus, reversed - a signal with no
 * relationship to the question asked, the way an untrained or broken embedding would
 * behave. */
const positionalRetriever: Retriever = (_question, corpus) => {
	const total = corpus.chunks.length;
	return corpus.chunks.map((chunk, index) => ({
		chunkId: chunk.id,
		score: (total - index) / total
	}));
};

describe('runRetrievalEval', () => {
	it('is seeded with real fixture prose, not lorem ipsum', () => {
		expect(valdoriaReachRetrieval.questions.length).toBeGreaterThan(0);
		const gildedRatChunk = valdoriaReachRetrieval.chunks.find((c) => c.id === 'the-gilded-rat#0');
		expect(gildedRatChunk?.text).toContain('Mother Sennah');
		expect(gildedRatChunk?.text).toContain('Lantern Quarter');
	});

	it('a retriever that never returns a hit scores zero on MRR and recall', async () => {
		const report = await runRetrievalEval(valdoriaReachRetrieval, emptyRetriever);
		expect(report.mrr).toBe(0);
		for (const recall of Object.values(report.recallAtK)) {
			expect(recall).toBe(0);
		}
		for (const effect of report.thresholdEffect) {
			expect(effect.meanResultCount).toBe(0);
		}
	});

	it('a retriever that returns the gold chunks first scores perfectly', async () => {
		const report = await runRetrievalEval(valdoriaReachRetrieval, goodRetriever);
		expect(report.mrr).toBe(1);
		expect(report.recallAtK[report.topK]).toBe(1);
		for (const question of report.questions) {
			expect(question.rank).toBe(1);
		}
	});

	it('a retriever with no real relevance signal scores strictly worse than the good one', async () => {
		const goodReport = await runRetrievalEval(valdoriaReachRetrieval, goodRetriever);
		const positionalReport = await runRetrievalEval(valdoriaReachRetrieval, positionalRetriever);
		expect(positionalReport.mrr).toBeLessThan(goodReport.mrr);
		expect(positionalReport.recallAtK[positionalReport.topK]).toBeLessThanOrEqual(
			goodReport.recallAtK[goodReport.topK]!
		);
	});

	it('raising the threshold monotonically shrinks the surviving result count', async () => {
		const report = await runRetrievalEval(valdoriaReachRetrieval, positionalRetriever, {
			threshold: 0.5,
			thresholdSweep: [0, 0.25, 0.5, 0.75, 0.9]
		});
		const sorted = [...report.thresholdEffect].sort((a, b) => a.threshold - b.threshold);
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i]!.meanResultCount).toBeLessThanOrEqual(sorted[i - 1]!.meanResultCount);
		}
	});

	it('top-k is a runner parameter, not baked into the retriever: a smaller top-k can only shrink recall', async () => {
		const wide = await runRetrievalEval(valdoriaReachRetrieval, positionalRetriever, { topK: 8 });
		const narrow = await runRetrievalEval(valdoriaReachRetrieval, positionalRetriever, { topK: 1 });
		expect(narrow.recallAtK[1]).toBeLessThanOrEqual(wide.recallAtK[1]!);
	});
});
