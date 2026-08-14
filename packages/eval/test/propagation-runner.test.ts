import { describe, expect, it } from 'vitest';
import { runPropagationEval } from '../src/propagation/runner.js';
import { propagationWorlds } from '../src/propagation/corpus/index.js';
import type { CandidateSelector } from '../src/propagation/types.js';

/** Proposes every other entity in the world, including everything on `mustNotPropose`.
 * The maximally noisy selector: perfect recall, worst possible precision. */
const returnsEverything: CandidateSelector = ({ world, propagationCase }) =>
	world.entities.map((e) => e.slug).filter((slug) => slug !== propagationCase.editedEntitySlug);

/** Proposes nothing at all. Perfect precision (no false positives possible), worst
 * possible recall. */
const returnsNothing: CandidateSelector = () => [];

/** Returns exactly the ground truth, in the documented order - the selector a harness
 * that measures anything at all has to score well. */
const matchesExpectations: CandidateSelector = ({ propagationCase }) => propagationCase.expected;

describe('runPropagationEval', () => {
	it('has at least three worlds, one of them the Valdoria Reach fixture', () => {
		expect(propagationWorlds.length).toBeGreaterThanOrEqual(3);
		expect(propagationWorlds.map((w) => w.id)).toContain('valdoria-reach');
		for (const world of propagationWorlds) {
			expect(world.cases.length).toBeGreaterThan(0);
		}
	});

	it('a selector that returns everything scores badly on precision', async () => {
		const report = await runPropagationEval(propagationWorlds, returnsEverything);
		expect(report.meanRecall).toBe(1);
		expect(report.meanFalsePositiveRate).toBe(1);
		expect(report.totalFalsePositives).toBeGreaterThan(0);
	});

	it('a selector that returns nothing scores badly on recall', async () => {
		const report = await runPropagationEval(propagationWorlds, returnsNothing);
		expect(report.meanRecall).toBe(0);
		expect(report.meanRecallAtCap).toBe(0);
		expect(report.meanOrderingScore).toBe(0);
		expect(report.meanFalsePositiveRate).toBe(0);
		expect(report.totalFalsePositives).toBe(0);
	});

	it('a selector that matches expectations scores well across every axis', async () => {
		const report = await runPropagationEval(propagationWorlds, matchesExpectations);
		expect(report.meanRecall).toBe(1);
		expect(report.meanRecallAtCap).toBe(1);
		expect(report.meanFalsePositiveRate).toBe(0);
		expect(report.totalFalsePositives).toBe(0);

		// Ordering is mean reciprocal rank of each expected entry within `selected`, so
		// placing every expected entry at the earliest possible rank (exactly this
		// selector's behaviour) is the best a selector can score, not literally 1 - a
		// case with two expected entries can place at most one of them at rank 1.
		const decoyPrefixed: CandidateSelector = ({ world, propagationCase }) => {
			const decoy = world.entities
				.map((e) => e.slug)
				.find((slug) => !propagationCase.expected.includes(slug));
			return decoy ? [decoy, ...propagationCase.expected] : propagationCase.expected;
		};
		const decoyReport = await runPropagationEval(propagationWorlds, decoyPrefixed);
		expect(report.meanOrderingScore).toBeGreaterThan(decoyReport.meanOrderingScore);
		expect(report.meanOrderingScore).toBeGreaterThan(0.5);
	});

	it('the good selector strictly outperforms the noisy one on precision, and the empty one on recall', async () => {
		const good = await runPropagationEval(propagationWorlds, matchesExpectations);
		const noisy = await runPropagationEval(propagationWorlds, returnsEverything);
		const empty = await runPropagationEval(propagationWorlds, returnsNothing);

		expect(good.meanFalsePositiveRate).toBeLessThan(noisy.meanFalsePositiveRate);
		expect(good.meanRecall).toBeGreaterThan(empty.meanRecall);
	});

	it('ordering degrades when expected entries are pushed past the cap', async () => {
		const lateOrder: CandidateSelector = ({ world, propagationCase }) => {
			const decoys = world.entities
				.map((e) => e.slug)
				.filter(
					(slug) =>
						slug !== propagationCase.editedEntitySlug && !propagationCase.expected.includes(slug)
				);
			// Push every expected entry past a cap of 2 by burying it behind decoys.
			return [...decoys, ...propagationCase.expected];
		};

		const uncappedReport = await runPropagationEval(propagationWorlds, lateOrder, { cap: 100 });
		const cappedReport = await runPropagationEval(propagationWorlds, lateOrder, { cap: 2 });

		expect(uncappedReport.meanRecall).toBe(1);
		expect(cappedReport.meanRecallAtCap).toBeLessThan(uncappedReport.meanRecallAtCap);
	});

	it('reports per-case detail with the world and case id attached', async () => {
		const report = await runPropagationEval(propagationWorlds, matchesExpectations);
		const valdoriaCase = report.cases.find(
			(c) => c.worldId === 'valdoria-reach' && c.caseId === 'aldric-appointment-review'
		);
		expect(valdoriaCase).toBeDefined();
		expect(valdoriaCase?.selected).toEqual([
			'iselde-wrenn',
			'the-ashen-ledger',
			'the-valdoria-watch'
		]);
	});
});
