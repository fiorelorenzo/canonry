import { describe, expect, it } from 'vitest';
import { runMatchingBenchmark } from './matching-benchmark.js';
import { SAMPLE_WORLD_MATCHING_CORPUS } from './matching-benchmark-corpus.js';
import { lexicalTrigramSimilarity } from './lexical-similarity.js';

describe('runMatchingBenchmark (issue #37)', () => {
	it('never touches a model or a database - scores a deterministic fake similarity function', async () => {
		const alwaysHalf = () => 0.5;
		const report = await runMatchingBenchmark(SAMPLE_WORLD_MATCHING_CORPUS, alwaysHalf, {
			thresholds: [0.4, 0.6]
		});
		expect(report.pairCount).toBe(SAMPLE_WORLD_MATCHING_CORPUS.pairs.length);
		// At threshold 0.4 everything scores "same" (0.5 >= 0.4): every negative pair is a
		// false merge, no positive pair is a false split.
		const negatives = SAMPLE_WORLD_MATCHING_CORPUS.pairs.filter((p) => !p.sameEntity).length;
		const positives = SAMPLE_WORLD_MATCHING_CORPUS.pairs.filter((p) => p.sameEntity).length;
		const low = report.scores.find((s) => s.threshold === 0.4);
		expect(low).toEqual({
			threshold: 0.4,
			falseMerges: negatives,
			falseSplits: 0,
			weightedCost: negatives * 5
		});
		// At threshold 0.6 everything scores "different" (0.5 < 0.6): every positive pair
		// is a false split, no negative pair is a false merge.
		const high = report.scores.find((s) => s.threshold === 0.6);
		expect(high).toEqual({
			threshold: 0.6,
			falseMerges: 0,
			falseSplits: positives,
			weightedCost: positives
		});
	});

	it('weights false merges heavier than false splits when suggesting a threshold', async () => {
		// Three pairs: one true positive that only scores 0.3, two true negatives that
		// both score 0.9. A threshold of 0.2 merges nothing correctly split (0 false
		// splits, 2 false merges); a threshold of 0.95 splits everything (1 false split,
		// 0 false merges). With false merges weighted at 5x, 0.95 must win.
		const corpus = {
			id: 'toy',
			name: 'toy',
			pairs: [
				{
					id: 'weak-positive',
					subject: { name: 'A', aliases: [] },
					candidate: { id: 'a', name: 'A', aliases: [] },
					sameEntity: true,
					note: 'weak positive'
				},
				{
					id: 'strong-negative-1',
					subject: { name: 'B', aliases: [] },
					candidate: { id: 'b', name: 'B', aliases: [] },
					sameEntity: false,
					note: 'strong negative'
				},
				{
					id: 'strong-negative-2',
					subject: { name: 'C', aliases: [] },
					candidate: { id: 'c', name: 'C', aliases: [] },
					sameEntity: false,
					note: 'strong negative'
				}
			]
		};
		const scoreById: Record<string, number> = {
			'weak-positive': 0.3,
			'strong-negative-1': 0.9,
			'strong-negative-2': 0.9
		};
		let index = 0;
		const orderedIds = corpus.pairs.map((p) => p.id);
		const similarity = () => scoreById[orderedIds[index++] as string] ?? 0;

		const report = await runMatchingBenchmark(corpus, similarity, { thresholds: [0.2, 0.95] });
		expect(report.suggestedThreshold.threshold).toBe(0.95);
	});

	it('runs the labelled corpus against the lexical stand-in similarity and prints its false-merge/false-split counts (issue #37 acceptance)', async () => {
		const report = await runMatchingBenchmark(
			SAMPLE_WORLD_MATCHING_CORPUS,
			lexicalTrigramSimilarity
		);

		// eslint-disable-next-line no-console
		console.log(
			`\nMatching benchmark: ${report.corpusId} (${report.pairCount} labelled pairs, ` +
				`false-merge weight ${report.falseMergeWeight}x)`
		);
		console.log('threshold  falseMerges  falseSplits  weightedCost');
		for (const s of report.scores) {
			console.log(
				`${s.threshold.toFixed(2).padStart(9)}  ${String(s.falseMerges).padStart(11)}  ` +
					`${String(s.falseSplits).padStart(11)}  ${String(s.weightedCost).padStart(12)}`
			);
		}
		console.log(
			`Corpus-suggested threshold (measured, not chosen): ${report.suggestedThreshold.threshold.toFixed(2)} - ` +
				`${report.suggestedThreshold.falseMerges} false merges, ${report.suggestedThreshold.falseSplits} false splits, ` +
				`weighted cost ${report.suggestedThreshold.weightedCost}`
		);

		expect(report.pairCount).toBe(SAMPLE_WORLD_MATCHING_CORPUS.pairs.length);
		expect(report.scores.length).toBeGreaterThan(0);

		// The translation pair (SPEC.md §6.4's own example) is the documented blind spot of
		// a lexical-only scorer: "the Gilded Rat" and "Il Ratto Dorato" share almost no
		// structure (only a coincidental "rat" substring from the Italian cognate "ratto"),
		// so the stand-in scores it far below every genuine retitle/typo/abbreviation pair
		// in the corpus - a real embedding model is what SPEC.md §6.4 requires precisely
		// because this pair is a true match despite that near-zero lexical score.
		const translationPair = SAMPLE_WORLD_MATCHING_CORPUS.pairs.find((p) => p.id === 'translation');
		expect(translationPair).toBeDefined();
		const translationScore = await lexicalTrigramSimilarity(
			translationPair!.subject,
			translationPair!.candidate
		);
		expect(translationScore).toBeLessThan(0.1);
		const retitleScore = await lexicalTrigramSimilarity(
			{ name: 'the Gilded Rat', aliases: [] },
			{ id: 'inn-gilded-rat', name: 'Gilded Rat Tavern', aliases: [] }
		);
		expect(translationScore).toBeLessThan(retitleScore);
	});
});
