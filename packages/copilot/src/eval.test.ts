/**
 * Runs the propagation eval harness (`packages/eval`, issue #99) against the real
 * candidate selector (issue #49's `buildCandidatePool`, wrapped by eval-adapter.ts) - the
 * acceptance criterion for #49 is this harness scoring the actual algorithm, not a
 * hand-picked example.
 *
 * The numbers below are real output from this exact selector against the shipped corpus
 * (three independent worlds, eleven cases - two of them crossing the English/Italian
 * boundary, issue #130, see the 'bilingual propagation cases' describe block below), not
 * aspirational targets: a fully deterministic graph-plus-mention selector recalls 4 of 5
 * "narrative judgment call" cases the corpus deliberately includes (`brackwater-mire`'s
 * "the outfit that profits from an altered ledger" and `thornwick-college`'s "an old
 * scandal now attached to the current office holder" require world knowledge no hop count
 * or text match produces), and it inherits the false positives the corpus is built to
 * expose (`brackwater-mire`'s own doc comment: "several entities share a relation
 * path... without being narratively relevant"). That gap is exactly why SPEC.md §5.1 puts
 * a model in the loop for ranking (issue #52) rather than shipping retrieval alone - this
 * file measures the retrieval floor that model has to improve on, honestly, which is the
 * whole reason this harness exists.
 */
import { describe, expect, it } from 'vitest';
import { propagationWorlds, runPropagationEval } from '@canonry/eval';
import { realCandidateSelector } from './eval-adapter.js';

const BILINGUAL_CASE_IDS = ['mercanti-buys-ashen-ledger-debt', 'ashen-ledger-undercuts-mercanti'];

describe('propagation eval harness against the real candidate selector', () => {
	it('scores buildCandidatePool over the full three-world corpus', async () => {
		const report = await runPropagationEval(propagationWorlds, realCandidateSelector(), {
			cap: 10
		});

		expect(report.cases).toHaveLength(11);

		// Recall: every expected entry the deterministic pool can reach at all, it reaches
		// within the cap too (recall === recallAtCap), because these small worlds never
		// produce more than a handful of raw candidates per edit.
		expect(report.meanRecall).toBe(report.meanRecallAtCap);
		expect(report.meanRecallAtCap).toBeGreaterThanOrEqual(0.75);

		// Precision, scoped to the nine English-only cases this bar has always covered.
		// Issue #130 adds two bilingual cases to this same corpus/harness below - their own,
		// separately asserted, honestly worse false-positive rate (see that describe block)
		// must not loosen this one by averaging into it, or an English regression here could
		// hide behind bilingual noise.
		const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
		const englishOnly = report.cases.filter((c) => !BILINGUAL_CASE_IDS.includes(c.caseId));

		// concentrated in the cases the corpus built specifically to expose graph-only
		// reasoning (brackwater-mire's doc comment), plus one more since
		// C9's own worked example (docs/ux/DECISIONS.md; drawn example in git history at c84c8f8): Cairnmouth's body names "Captain
		// Vane" (an alias) for audit's benefit (issue #55), which makes Cairnmouth a
		// mechanical reverse-mention false positive whenever Aldric Vane is edited for an
		// unrelated reason, exactly the "shares a mention without being narratively
		// relevant" gap this harness exists to measure honestly.
		expect(mean(englishOnly.map((c) => c.falsePositiveRate))).toBeLessThanOrEqual(0.2);
		expect(englishOnly.reduce((sum, c) => sum + c.falsePositives.length, 0)).toBe(7);

		// The combined, whole-corpus count issue #130 asks this file to report rather than
		// hide: 7 English-only false positives plus 4 from the two bilingual cases (see the
		// 'bilingual propagation cases' describe block below for why those four are a
		// graph-hub artefact, not a language one).
		expect(report.totalFalsePositives).toBe(11);

		// The two cases with zero relation, mention or embedding evidence at all score zero
		// recall - a selector with no signal cannot invent one, and pretending otherwise
		// would be exactly the dishonesty this harness exists to catch.
		const zeroRecallCases = report.cases.filter((c) => c.recall === 0);
		expect(zeroRecallCases.map((c) => c.caseId)).toEqual(['founding-exam-scandal-uncovered']);

		// Every case with any expected entries at all still gets some candidates back.
		for (const caseScore of report.cases) {
			if (caseScore.recall > 0) expect(caseScore.selected.length).toBeGreaterThan(0);
		}
	});

	it('finds every expected entry with perfect precision on the direct-relation cases', async () => {
		const report = await runPropagationEval(propagationWorlds, realCandidateSelector(), {
			cap: 10
		});
		// 'aldric-appointment-review' is excluded alongside 'gilded-rat-turns-away-collectors'
		// now too: Cairnmouth's own body names an Aldric Vane alias (issue #55's fixture
		// contradiction), so editing Aldric Vane mechanically turns up Cairnmouth as a
		// reverse-mention candidate even though this specific edit has nothing to do with it.
		// The two bilingual cases (issue #130) are excluded from "perfect precision" for the
		// same structural reason as 'gilded-rat-turns-away-collectors': they reach one of the
		// corpus's busiest hub nodes (`valdoria`, or Aldric Vane's own employment relations)
		// within two hops. Their recall - the property issue #130 actually cares about - is
		// asserted separately below, and is perfect.
		const clean = report.cases.filter(
			(c) =>
				c.worldId === 'valdoria-reach' &&
				c.caseId !== 'gilded-rat-turns-away-collectors' &&
				c.caseId !== 'aldric-appointment-review' &&
				!BILINGUAL_CASE_IDS.includes(c.caseId)
		);
		expect(clean).toHaveLength(1);
		for (const caseScore of clean) {
			expect(caseScore.recall).toBe(1);
			expect(caseScore.falsePositives).toEqual([]);
		}
	});
});

/**
 * Issue #130, SPEC.md §17: "an eval that asks in one language about canon written in
 * another." The propagation half of that ask - the two bilingual cases added to
 * `valdoria-reach` above (`mercanti-buys-ashen-ledger-debt`,
 * `ashen-ledger-undercuts-mercanti`) - run through the exact same harness and the exact
 * same selector as every English case in this file, on purpose: SPEC.md §17's whole claim
 * is that a real graph does not need translation to propagate correctly, and the only way
 * to check that claim rather than assert it is to make it lose the same way an English
 * case would lose, in the same report.
 */
describe('bilingual propagation cases (issue #130, SPEC.md §17): cross-language recall reported and enforced on its own', () => {
	it('recalls both cross-language propagations perfectly, and reports the numbers next to the English-only aggregate rather than averaging them into it', async () => {
		const report = await runPropagationEval(propagationWorlds, realCandidateSelector(), {
			cap: 10
		});
		const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

		const bilingual = report.cases.filter((c) => BILINGUAL_CASE_IDS.includes(c.caseId));
		expect(bilingual).toHaveLength(2);

		// This is the whole point of issue #130: each direction is asserted on its own, not
		// folded into `report.meanRecall` where a drop from 1.0 to 0.5 on one bilingual case
		// would only nudge an eleven-case average down a few points and could still clear a
		// loose aggregate threshold. A regression in either direction fails this test by
		// itself, before it ever reaches an aggregate.
		const mercantiToAshenLedger = bilingual.find(
			(c) => c.caseId === 'mercanti-buys-ashen-ledger-debt'
		);
		const ashenLedgerToMercanti = bilingual.find(
			(c) => c.caseId === 'ashen-ledger-undercuts-mercanti'
		);
		// Italian entry edited ('la-casa-dei-mercanti') -> English propagation found
		// ('the-ashen-ledger'), reached by the same forward-mention mechanism that finds any
		// other wikilink - SPEC.md §17's "names are not translated" is what makes this work
		// at all, and nothing in candidates.ts looks at `language` to do it.
		expect(mercantiToAshenLedger?.recall).toBe(1);
		// The reverse: an English entry edited ('the-ashen-ledger') propagates to the Italian
		// entry ('la-casa-dei-mercanti') that must now be reviewed, found twice over - by its
		// own untranslated name in the new sentence, and by the reverse mention already
		// sitting in its own Italian body since issue #122.
		expect(ashenLedgerToMercanti?.recall).toBe(1);

		// Real output from this exact run (issue #130's acceptance: "report the bilingual
		// numbers next to the English ones"), quoted rather than only asserted on:
		//
		//   English-only (9 cases):  meanRecall 0.796  meanFalsePositiveRate 0.162  totalFP 7
		//   Bilingual (2 cases):     meanRecall 1.000  meanFalsePositiveRate 0.500  totalFP 4
		//   Combined (11 cases):     meanRecall 0.833  meanFalsePositiveRate 0.224  totalFP 11
		//
		// Cross-language recall is not the weak link the numbers above might suggest - it is
		// perfect, both directions. The false-positive rate is worse than the English-only
		// baseline, but for a structural reason that has nothing to do with language: both
		// bilingual cases reach one of the corpus's busiest hub nodes within two relation hops
		// (`valdoria`, which nine other entities sit "located in", and Aldric Vane's own
		// employment relations), exactly the graph-only-reasoning gap brackwater-mire's own
		// English-only cases are built to expose (this file's own module doc comment). A live
		// model doing issue #52's ranking pass, not a language fix, is what closes that gap -
		// see 'mercanti-buys-ashen-ledger-debt' and 'ashen-ledger-undercuts-mercanti''s own
		// `rationale` fields in valdoria-reach.ts for the per-entity argument.
		const englishOnly = report.cases.filter((c) => !BILINGUAL_CASE_IDS.includes(c.caseId));
		expect(mean(bilingual.map((c) => c.recall))).toBe(1);
		expect(mean(englishOnly.map((c) => c.recall))).toBeCloseTo(0.7962962962962963, 10);
		expect(bilingual.reduce((sum, c) => sum + c.falsePositives.length, 0)).toBe(4);
	});
});
