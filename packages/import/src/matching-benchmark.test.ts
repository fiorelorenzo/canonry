import { describe, expect, it } from 'vitest';
import {
	poolSubjectsFromCorpus,
	runMatchingBenchmark,
	runPoolOrderingBenchmark,
	type MatchingCorpus,
	type PoolSubject
} from './matching-benchmark.js';
import { SAMPLE_WORLD_MATCHING_CORPUS } from './matching-benchmark-corpus.js';
import { lexicalTrigramSimilarity } from './lexical-similarity.js';
import { MATCH_THRESHOLDS, type MatchCandidate } from './matching.js';

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

describe('poolSubjectsFromCorpus (issue #641)', () => {
	it('groups a subject scored against several candidates into one sighting', () => {
		const subjects = poolSubjectsFromCorpus(SAMPLE_WORLD_MATCHING_CORPUS);
		// "Aldric Voss" is scored against Aldric, against Aldric the Younger and against
		// Seraphine in three separate pairs, and a real import sees one sighting with three
		// candidates in its pool, not three imports.
		const aldric = subjects.find((s) => s.id === 'character:aldric voss');
		expect(aldric).toBeDefined();
		expect(aldric!.sameEntityIds).toEqual(['char-aldric']);
		expect(aldric!.otherEntityIds).toEqual(['char-aldric-junior', 'char-seraphine']);
		// Fewer sightings than pairs, and every distinct (subject, candidate) label kept. Not
		// every *pair*: the corpus scores "the Gilded Rat" against `inn-gilded-rat` twice, once
		// under each wording, and one universe holds one row for that entity.
		expect(subjects.length).toBeLessThan(SAMPLE_WORLD_MATCHING_CORPUS.pairs.length);
		const labelled = subjects.reduce(
			(sum, s) => sum + s.sameEntityIds.length + s.otherEntityIds.length,
			0
		);
		const distinctLabels = new Set(
			SAMPLE_WORLD_MATCHING_CORPUS.pairs.map(
				(p) =>
					`${p.subject.context?.type ?? 'untyped'}:${p.subject.name.toLowerCase()}:${p.candidate.id}`
			)
		);
		expect(labelled).toBe(distinctLabels.size);
	});

	it('separates two subjects that share a name across types', () => {
		const corpus: MatchingCorpus = {
			id: 'shared-name',
			name: 'shared name across types',
			pairs: [
				{
					id: 'a',
					subject: {
						name: 'Thornwick',
						aliases: [],
						context: { type: 'place', summary: null, sourceSentence: null }
					},
					candidate: { id: 'place-thornwick', name: 'Thornwick', aliases: [] },
					sameEntity: true,
					note: 'the college'
				},
				{
					id: 'b',
					subject: {
						name: 'Thornwick',
						aliases: [],
						context: { type: 'faction', summary: null, sourceSentence: null }
					},
					candidate: { id: 'faction-thornwick', name: 'Thornwick', aliases: [] },
					sameEntity: true,
					note: 'the house'
				}
			]
		};
		expect(poolSubjectsFromCorpus(corpus).map((s) => s.id)).toEqual([
			'place:thornwick',
			'faction:thornwick'
		]);
	});
});

describe('runPoolOrderingBenchmark (issue #641)', () => {
	const truth: MatchCandidate = { id: 'right', name: 'Gilded Rat Tavern', aliases: [] };
	const decoy: MatchCandidate = { id: 'wrong', name: 'Gilded Rat Tavern', aliases: [] };
	const subjects: PoolSubject[] = [
		{
			id: 'place:the gilded rat',
			subject: { name: 'the Gilded Rat', aliases: [] },
			sameEntityIds: ['right'],
			otherEntityIds: ['wrong']
		}
	];

	it('counts a false split when the ordering drops the right candidate, and a false merge when it keeps only the wrong one', async () => {
		const report = await runPoolOrderingBenchmark(
			'pool-ordering-unit',
			subjects,
			[
				{ id: 'keeps-truth', fetchPool: () => ({ candidates: [truth], truncated: true }) },
				{ id: 'keeps-nothing', fetchPool: () => ({ candidates: [], truncated: true }) },
				{ id: 'keeps-decoy', fetchPool: () => ({ candidates: [decoy], truncated: true }) }
			],
			// A scorer that says "same entity" for anything it is handed, so the only thing
			// moving between the three rows is which candidate the pool contained.
			() => 1,
			{ thresholds: MATCH_THRESHOLDS }
		);

		const byId: Record<string, (typeof report.scores)[number]> = {};
		for (const score of report.scores) byId[score.orderingId] = score;

		expect(byId['keeps-truth']).toMatchObject({
			trueCandidateMissing: 0,
			trueCandidateUnscored: 0,
			matched: 1,
			falseMerges: 0,
			falseSplits: 0,
			weightedCost: 0
		});
		expect(byId['keeps-nothing']).toMatchObject({
			trueCandidateMissing: 1,
			trueCandidateUnscored: 1,
			falseMerges: 0,
			falseSplits: 1,
			weightedCost: 1
		});
		// The expensive error, and the one a pair-at-a-time benchmark cannot express: the right
		// candidate is absent and a wrong one is present, so the sighting folds into it.
		expect(byId['keeps-decoy']).toMatchObject({
			trueCandidateMissing: 1,
			falseMerges: 1,
			falseSplits: 0,
			weightedCost: 5
		});
	});

	it('reports a pool that held the right candidate and a pre-filter that dropped it anyway', async () => {
		// The finding this exists to make visible: `preFilterCandidates` breaks ties on the
		// input order, so with a pre-filter of 2 and a subject sharing no token with anything,
		// the pool's own order decides which candidates are scored. The right candidate is last
		// in the pool and shares no token with the subject, so it never reaches the scorer even
		// though the pool contained it.
		const filler: MatchCandidate[] = [
			{ id: 'f1', name: 'Bala Ash', aliases: [] },
			{ id: 'f2', name: 'Brae Bray', aliases: [] }
		];
		const translated: MatchCandidate = { id: 'right', name: 'Il Ratto Dorato', aliases: [] };
		const report = await runPoolOrderingBenchmark(
			'pool-ordering-unit',
			[
				{
					id: 'place:the gilded rat',
					subject: { name: 'the Gilded Rat', aliases: [] },
					sameEntityIds: ['right'],
					otherEntityIds: []
				}
			],
			[
				{
					id: 'truth-last',
					fetchPool: () => ({ candidates: [...filler, translated], truncated: false })
				},
				{
					id: 'truth-first',
					fetchPool: () => ({ candidates: [translated, ...filler], truncated: false })
				}
			],
			// Right only for the true candidate, so the only thing moving between the two rows is
			// which candidates the pre-filter let through.
			(_subject, candidate) => (candidate.id === 'right' ? 1 : 0),
			{ thresholds: MATCH_THRESHOLDS, preFilterLimit: 2 }
		);
		const [last, first] = report.scores;
		expect(last).toMatchObject({
			orderingId: 'truth-last',
			trueCandidateMissing: 0,
			trueCandidateUnscored: 1,
			// Issue #666: the pool was not truncated and was narrowed anyway, which is the
			// distinction the two figures exist to keep apart.
			narrowedPools: 1,
			falseSplits: 1
		});
		expect(last!.outcomes[0]).toMatchObject({ poolSize: 3, scoredSize: 2, truncated: false });
		expect(first).toMatchObject({
			orderingId: 'truth-first',
			trueCandidateMissing: 0,
			trueCandidateUnscored: 0,
			narrowedPools: 1,
			matched: 1
		});
	});

	it('counts a subject with no true candidate as correctly new rather than as a split', async () => {
		const report = await runPoolOrderingBenchmark(
			'pool-ordering-unit',
			[
				{
					id: 'character:seraphine duval',
					subject: { name: 'Seraphine Duval', aliases: [] },
					sameEntityIds: [],
					otherEntityIds: ['someone-else']
				}
			],
			[{ id: 'empty', fetchPool: () => ({ candidates: [], truncated: false }) }],
			lexicalTrigramSimilarity,
			{ thresholds: MATCH_THRESHOLDS }
		);
		expect(report.scores[0]).toMatchObject({
			correctlyNew: 1,
			falseSplits: 0,
			falseMerges: 0,
			weightedCost: 0
		});
		expect(report.scores[0]!.outcomes[0]!.trueCandidateInPool).toBeNull();
		// And nothing was narrowed, because there was nothing to narrow: a pre-filter that never
		// dropped a row must not read as one that did (issue #666).
		expect(report.scores[0]).toMatchObject({ narrowedPools: 0 });
	});
});
