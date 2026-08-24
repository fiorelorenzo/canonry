/**
 * Issue #637. Two halves, and the first matters more than the second.
 *
 * **The corpus is checked for well-formedness before anything is scored.** A gold set is
 * only worth what its labelling discipline is worth, and the failure modes are specific:
 * a pair whose two sides are byte-identical without saying so (which measures string
 * equality and reports it as understanding), a `rungOne` flag that has drifted away from
 * what rung 1 actually resolves, a control pair quietly deleted, a corpus that has become
 * single-language on the proposed side. Each of those is an assertion here, and the
 * `rungOne` one is checked against the production predicate rather than a copy of it.
 *
 * **Then the runner, on a deterministic scorer and no database.** The last case runs
 * `hashingEmbedder`, this repo's only network-free embedder, over the whole corpus and
 * prints the table. That is not a proposal to use it: it is #629's finding as a regression
 * test. The stand-in scores "fondata da" against `appointed`'s Italian inverse label at a
 * perfect 1.0 through a 256-bucket collision, so at the shipped threshold it commits
 * exactly one false merge and it is that one. If a future change to `hashingEmbedder` makes
 * that collision go away, this test fails and somebody has to look at why the corpus's
 * documented example stopped being an example.
 */
import { describe, expect, it } from 'vitest';
import { hashingEmbedder } from '@canonry/indexing';
import { RELATION_TYPE_CATALOGUE } from '@canonry/lang';
import {
	classifyRelationLabelPair,
	relationLabelCandidates,
	rungOneDirection,
	runRelationLabelBenchmark,
	shippedRelationTypeIdentity,
	type RelationLabelCorpus,
	type RelationLabelSimilarityFn
} from './relation-label-benchmark.js';
import { ONENOTE_RELATION_LABEL_CORPUS } from './relation-label-benchmark-corpus.js';
import { SEMANTIC_REUSE_THRESHOLD } from './relation-types.js';

const corpus = ONENOTE_RELATION_LABEL_CORPUS;

/** Local rather than imported: `cosineSimilarity` lives in `@canonry/import`, which depends
 * on this package, so importing it here would be a cycle. Six lines, and
 * `packages/media/src/embedding.test.ts` already keeps its own for the same reason. */
function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / Math.sqrt(normA * normB);
}

/** The one network-free scorer this repo has, wired the way `bestSemanticMatch` wires the
 * real one: one batched call, then cosine. */
const hashingSimilarity: RelationLabelSimilarityFn = async (proposedLabel, catalogueLabel) => {
	const [a, b] = await hashingEmbedder([proposedLabel, catalogueLabel]);
	return cosineSimilarity(a ?? [], b ?? []);
};

/** Deleting one of these is a change to what the corpus can prove, so it has to be a
 * deliberate edit to this list and not a quiet removal from the data. */
const REQUIRED_CONTROL_IDS = [
	'control-comandato-dal-vs-appointed',
	'control-membro-di-vs-part-of',
	'control-parte-di-vs-member-of',
	'control-sindaco-di-vs-commands',
	'control-sindaco-di-vs-member-of',
	'n629-fondata-da-vs-appointed',
	'n629-combatte-contro-vs-ally-of',
	'n629-lavora-per-vs-employs',
	'n629-contiene-parti-di-vs-part-of',
	'rung1-ha-come-membro'
];

describe('the relation-label corpus is well formed (issue #637)', () => {
	it('gives every pair a unique id and never asks the same question twice', () => {
		const ids = corpus.pairs.map((pair) => pair.id);
		expect(new Set(ids).size).toBe(ids.length);
		const questions = corpus.pairs.map((pair) => `${pair.proposedLabel}\u0000${pair.catalogueKey}`);
		expect(new Set(questions).size).toBe(questions.length);
	});

	it('scores every pair against a shipped catalogue key', () => {
		const shipped = new Set(Object.keys(RELATION_TYPE_CATALOGUE.en));
		for (const pair of corpus.pairs) {
			expect(shipped, `${pair.id} names a key the catalogue does not ship`).toContain(
				pair.catalogueKey
			);
		}
	});

	it('never carries a byte-identical pair unless that is the point, and says so when it is', () => {
		let normalisedOnly = 0;
		for (const pair of corpus.pairs) {
			const identical = relationLabelCandidates(pair.catalogueKey).some(
				(candidate) => candidate.label === pair.proposedLabel
			);
			// One direction only, and the other direction is the next assertion. A pair whose
			// proposed label *is* one of the type's labels measures string equality, so it may
			// only be here as a declared rung-1 control. The converse does not hold, because
			// rung 1 normalises before it compares: `rung1-inflected-english` is resolved by
			// rung 1 and is not byte-identical to anything, which is the point of it.
			if (identical) {
				expect(pair.rungOne, `${pair.id}: byte-identical to a catalogue label`).toBe(true);
			} else if (pair.rungOne) {
				normalisedOnly += 1;
			}
		}
		// And the corpus keeps at least one of those, so a change to `normalizeRelationLabel`
		// fails here rather than quietly moving a pair from rung 1 to rung 2.
		expect(normalisedOnly).toBeGreaterThan(0);
	});

	it('declares rungOne exactly where the production rung 1 resolves the pair, and never guesses the flag', () => {
		for (const pair of corpus.pairs) {
			const direction = rungOneDirection(pair.catalogueKey, pair.proposedLabel);
			expect(direction !== null, `${pair.id}: rungOne declaration disagrees with rung 1`).toBe(
				pair.rungOne
			);
			if (direction === null) continue;
			// A pair rung 1 resolves cannot be `distinct`: rung 1 would reuse the type before
			// the threshold was ever consulted, so a `distinct` verdict there would be a defect
			// in the shipped catalogue rather than a question about a cutoff.
			expect(pair.verdict, `${pair.id}: rung 1 resolves it, so it cannot be distinct`).not.toBe(
				'distinct'
			);
			const expected = pair.verdict === 'same' ? 'forward' : 'inverse';
			expect(direction, `${pair.id}: rung 1 resolves it in the other direction`).toBe(expected);
		}
	});

	it('never labels a pair against a symmetric type as inverse, because there is no direction there', () => {
		for (const pair of corpus.pairs) {
			const identity = shippedRelationTypeIdentity(pair.catalogueKey);
			if (identity.label !== identity.inverseLabel) continue;
			expect(pair.verdict, `${pair.id}: ${pair.catalogueKey} is symmetric`).not.toBe('inverse');
		}
	});

	it('carries all three outcomes in usable numbers, since a two-outcome corpus measures the wrong thing (#628)', () => {
		const counts = { same: 0, inverse: 0, distinct: 0 };
		for (const pair of corpus.pairs) counts[pair.verdict] += 1;
		expect(counts.same).toBeGreaterThanOrEqual(8);
		expect(counts.inverse).toBeGreaterThanOrEqual(8);
		expect(counts.distinct).toBeGreaterThanOrEqual(20);
		// The rung-2-only subset is the only one the semantic rung answers for, so it has to
		// keep all three outcomes too - a corpus whose inverse pairs were all rung-1 exact
		// matches could not measure a direction error at all.
		const rungTwo = corpus.pairs.filter((pair) => !pair.rungOne);
		expect(new Set(rungTwo.map((pair) => pair.verdict))).toEqual(
			new Set(['same', 'inverse', 'distinct'])
		);
	});

	it('keeps both shipped languages on the proposed side, so language is not a proxy for the answer', () => {
		// Crude but sufficient: an English label of this corpus is one made only of ASCII
		// words that are not Italian function words. What the assertion is really about is
		// that neither language is exclusively one verdict, which is the confound #279's
		// bilingual controls exist to prevent on the entity side.
		const italianMarkers = /(^| )(di|da|dal|del|in|nel|per|contro|come|è|si|ha)( |$)|à|è|ì|ò|ù/;
		const byLanguage = { it: new Set<string>(), en: new Set<string>() };
		for (const pair of corpus.pairs) {
			const language = italianMarkers.test(pair.proposedLabel) ? 'it' : 'en';
			byLanguage[language].add(pair.verdict);
		}
		expect(byLanguage.it.size).toBeGreaterThan(1);
		expect(byLanguage.en.size).toBeGreaterThan(1);
	});

	it('still carries every control the corpus needs to be falsifiable', () => {
		const ids = new Set(corpus.pairs.map((pair) => pair.id));
		for (const id of REQUIRED_CONTROL_IDS) expect(ids).toContain(id);
	});

	it('gives every pair a note, because an unexplained pair is an assertion rather than a judgement', () => {
		for (const pair of corpus.pairs) {
			expect(pair.note.length, `${pair.id} has no note`).toBeGreaterThan(30);
		}
	});
});

describe('runRelationLabelBenchmark (issue #637)', () => {
	it('touches neither a model nor a database, and separates the three errors', async () => {
		const report = await runRelationLabelBenchmark(corpus, () => 0.5, {
			thresholds: [0.4, 0.6]
		});
		expect(report.pairCount).toBe(corpus.pairs.length);

		const distinct = corpus.pairs.filter((pair) => pair.verdict === 'distinct').length;
		const same = corpus.pairs.filter((pair) => pair.verdict === 'same').length;
		const inverse = corpus.pairs.filter((pair) => pair.verdict === 'inverse').length;

		// A constant scorer ties every candidate label, and a tie goes to the earlier one in
		// `relationTypeMatchCandidates` order, which is forward-first. So at 0.4 everything
		// merges forward: every `distinct` pair is a false merge and every `inverse` pair is a
		// direction error, which is the outcome a two-class benchmark would have scored as a
		// success.
		const low = report.whole.scores.find((score) => score.threshold === 0.4);
		expect(low?.falseMerges).toBe(distinct);
		expect(low?.directionErrors).toBe(inverse);
		expect(low?.falseSplits).toBe(0);
		expect(low?.weightedCost).toBe(distinct * 5 + inverse * 2);

		// At 0.6 nothing merges: every true pair is a false split, whichever direction it
		// wanted.
		const high = report.whole.scores.find((score) => score.threshold === 0.6);
		expect(high?.falseMerges).toBe(0);
		expect(high?.directionErrors).toBe(0);
		expect(high?.falseSplits).toBe(same + inverse);
		expect(high?.weightedCost).toBe(same + inverse);
	});

	it('weights a false merge above a direction error above a false split', async () => {
		const synthetic: RelationLabelCorpus = {
			id: 'weights',
			name: 'three pairs, one of each verdict',
			pairs: [
				{
					id: 'a-distinct',
					proposedLabel: 'nemico di',
					catalogueKey: 'ally_of',
					verdict: 'distinct',
					rungOne: false,
					note: 'the false merge this case exists to price, and the expensive one under L1'
				},
				{
					id: 'b-inverse',
					proposedLabel: 'lavora per',
					catalogueKey: 'employs',
					verdict: 'inverse',
					rungOne: false,
					note: 'merged forward by a constant scorer, so it prices a direction error'
				},
				{
					id: 'c-same',
					proposedLabel: 'hires',
					catalogueKey: 'employs',
					verdict: 'same',
					rungOne: false,
					note: 'split by a high threshold, so it prices the cheap error'
				}
			]
		};
		const report = await runRelationLabelBenchmark(synthetic, () => 0.5, {
			thresholds: [0.4, 0.6]
		});
		const low = report.whole.scores.find((score) => score.threshold === 0.4);
		const high = report.whole.scores.find((score) => score.threshold === 0.6);
		// 0.4: one false merge (5) plus one direction error (2) = 7.
		expect(low?.weightedCost).toBe(7);
		// 0.6: two false splits = 2, so the conservative threshold is cheaper even though it
		// gets two of three pairs wrong. That is the asymmetry L1 asks for, priced.
		expect(high?.weightedCost).toBe(2);
		expect(report.whole.suggestedThreshold.threshold).toBe(0.6);
	});

	it('breaks a cost tie towards the higher threshold, which is the safe direction on this rung', async () => {
		const synthetic: RelationLabelCorpus = {
			id: 'tie',
			name: 'one pair, so every threshold above its score costs the same',
			pairs: [
				{
					id: 'only',
					proposedLabel: 'hires',
					catalogueKey: 'employs',
					verdict: 'same',
					rungOne: false,
					note: 'one true pair scoring 0.5, so 0.6 and 0.8 both cost exactly one false split'
				}
			]
		};
		const report = await runRelationLabelBenchmark(synthetic, () => 0.5, {
			thresholds: [0.6, 0.8]
		});
		expect(report.whole.suggestedThreshold.threshold).toBe(0.8);
	});

	it('reports the pairs behind every count, so a reviewer reads names and not only a number', async () => {
		const report = await runRelationLabelBenchmark(corpus, () => 1, { thresholds: [0.5] });
		const score = report.whole.scores[0];
		expect(score?.falseMergeIds).toContain('n629-combatte-contro-vs-ally-of');
		expect(score?.directionErrorIds).toContain('n629-lavora-per-vs-employs');
		expect(score?.falseMergeIds.length).toBe(score?.falseMerges);
		expect(score?.directionErrorIds.length).toBe(score?.directionErrors);
	});

	it('sweeps the rung-2-only subset next to the whole corpus, because rung 1 gets no credit for the rung below it', async () => {
		const report = await runRelationLabelBenchmark(corpus, () => 0.5, { thresholds: [0.4] });
		const rungOnePairs = corpus.pairs.filter((pair) => pair.rungOne).length;
		expect(rungOnePairs).toBeGreaterThan(0);
		expect(report.rungTwoOnly.pairCount).toBe(corpus.pairs.length - rungOnePairs);
		expect(report.whole.pairCount).toBe(corpus.pairs.length);
	});

	it('scores a pair the way bestSemanticMatch does: the best label of the expanded set wins, and its direction is the answer', async () => {
		// `owns` expands to `owns`, `owned by`, `possiede`, `posseduto da`. A scorer that only
		// recognises the Italian inverse must still report a match, on the inverse end.
		const onlyPosseduto: RelationLabelSimilarityFn = (_proposed, catalogueLabel) =>
			catalogueLabel === 'posseduto da' ? 0.99 : 0.1;
		const report = await runRelationLabelBenchmark(
			{
				id: 'expansion',
				name: 'one pair against the whole expanded set',
				pairs: [
					{
						id: 'di-proprieta-di-vs-owns',
						proposedLabel: 'di proprietà di',
						catalogueKey: 'owns',
						verdict: 'inverse',
						rungOne: false,
						note: 'only the Italian inverse label scores, so the direction has to come off that label'
					}
				]
			},
			onlyPosseduto,
			{ thresholds: [0.9] }
		);
		const scored = report.pairScores[0];
		expect(scored?.similarity).toBeCloseTo(0.99, 10);
		expect(scored?.matchedLabel).toBe('posseduto da');
		expect(scored?.direction).toBe('inverse');
		expect(classifyRelationLabelPair(scored!, 0.9)).toBe('correct-merge');
	});

	it('runs the whole corpus against the offline hashing stand-in and prints the sweep (#637 acceptance, #629 regression)', async () => {
		const report = await runRelationLabelBenchmark(corpus, hashingSimilarity);

		/* eslint-disable no-console */
		console.log(
			`\nRelation-label benchmark: ${report.corpusId} (${report.pairCount} labelled pairs, ` +
				`${report.rungTwoOnly.pairCount} of them past rung 1; false-merge weight ` +
				`${report.falseMergeWeight}x, direction-error weight ${report.directionErrorWeight}x)`
		);
		console.log('Scorer: hashingEmbedder cosine, which #629 disqualified for this rung');
		console.log(
			'| threshold | falseMerge | dirError | falseSplit | cost | rung2 falseMerge | rung2 dirError | rung2 falseSplit | rung2 cost |'
		);
		console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
		for (const [index, score] of report.whole.scores.entries()) {
			const rungTwo = report.rungTwoOnly.scores[index];
			console.log(
				`| ${score.threshold.toFixed(2)} | ${score.falseMerges} | ${score.directionErrors} | ` +
					`${score.falseSplits} | ${score.weightedCost} | ${rungTwo?.falseMerges} | ` +
					`${rungTwo?.directionErrors} | ${rungTwo?.falseSplits} | ${rungTwo?.weightedCost} |`
			);
		}
		const shipped = report.whole.scores.find(
			(score) => Math.abs(score.threshold - SEMANTIC_REUSE_THRESHOLD) < 1e-9
		);
		console.log(
			`Shipped SEMANTIC_REUSE_THRESHOLD ${SEMANTIC_REUSE_THRESHOLD}: ` +
				`${shipped?.falseMerges} false merges (${shipped?.falseMergeIds.join(', ') || 'none'}), ` +
				`${shipped?.directionErrors} direction errors, ${shipped?.falseSplits} false splits`
		);
		console.log(
			`Corpus-suggested threshold on this scorer (measured, not chosen): ` +
				`${report.whole.suggestedThreshold.threshold.toFixed(2)} at cost ` +
				`${report.whole.suggestedThreshold.weightedCost}; rung-2-only subset ` +
				`${report.rungTwoOnly.suggestedThreshold.threshold.toFixed(2)} at cost ` +
				`${report.rungTwoOnly.suggestedThreshold.weightedCost}`
		);
		/* eslint-enable no-console */

		// #629's finding, as an assertion rather than a sentence: the stand-in scores this pair
		// at a perfect 1.0 through a 256-bucket collision between "fondata" and "nominato", so
		// at the shipped threshold it commits exactly one false merge and it is that one.
		const collision = report.pairScores.find(
			(scored) => scored.pair.id === 'n629-fondata-da-vs-appointed'
		);
		expect(collision?.similarity).toBeCloseTo(1, 10);
		expect(collision?.matchedLabel).toBe('nominato da');
		expect(shipped?.falseMergeIds).toEqual(['n629-fondata-da-vs-appointed']);

		// And the other half of why it is disqualified: at the shipped threshold it buys no
		// correct merge at all past rung 1, so the one thing it does on this corpus is the
		// wrong thing.
		const rungTwoShipped = report.rungTwoOnly.scores.find(
			(score) => Math.abs(score.threshold - SEMANTIC_REUSE_THRESHOLD) < 1e-9
		);
		expect(rungTwoShipped?.falseSplits).toBe(
			corpus.pairs.filter((pair) => !pair.rungOne && pair.verdict !== 'distinct').length
		);
	});
});
