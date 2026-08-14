import type {
	CandidateSelector,
	PropagationCase,
	PropagationCaseScore,
	PropagationEvalOptions,
	PropagationReport,
	PropagationWorld
} from './types.js';

const DEFAULT_CAP = 10;

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function scoreCase(
	world: PropagationWorld,
	propagationCase: PropagationCase,
	selected: string[],
	cap: number
): PropagationCaseScore {
	const capped = selected.slice(0, cap);
	const cappedSet = new Set(capped);
	const selectedSet = new Set(selected);

	const expected = propagationCase.expected;
	const recall =
		expected.length === 0
			? 1
			: expected.filter((slug) => selectedSet.has(slug)).length / expected.length;
	const recallAtCap =
		expected.length === 0
			? 1
			: expected.filter((slug) => cappedSet.has(slug)).length / expected.length;

	const falsePositives = propagationCase.mustNotPropose.filter((slug) => selectedSet.has(slug));
	const falsePositivesAtCap = propagationCase.mustNotPropose.filter((slug) => cappedSet.has(slug));
	const falsePositiveRate =
		propagationCase.mustNotPropose.length === 0
			? 0
			: falsePositives.length / propagationCase.mustNotPropose.length;

	const reciprocalRanks = expected.map((slug) => {
		const rank = selected.indexOf(slug);
		return rank === -1 ? 0 : 1 / (rank + 1);
	});
	const orderingScore = expected.length === 0 ? 1 : mean(reciprocalRanks);

	return {
		worldId: world.id,
		caseId: propagationCase.id,
		selected,
		recall,
		recallAtCap,
		falsePositives,
		falsePositivesAtCap,
		falsePositiveRate,
		orderingScore
	};
}

/**
 * Runs every case of every world through `selector` and scores it. Never touches a model
 * or a database: `selector` is the only thing it calls, which is what lets a deliberately
 * bad stub (returns everything, returns nothing) and a deliberately good one (matches
 * `expected` exactly) both be exercised in a unit test - see `test/propagation-runner.
 * test.ts`.
 */
export async function runPropagationEval(
	worlds: PropagationWorld[],
	selector: CandidateSelector,
	options: PropagationEvalOptions = {}
): Promise<PropagationReport> {
	const cap = options.cap ?? DEFAULT_CAP;
	const cases: PropagationCaseScore[] = [];

	for (const world of worlds) {
		for (const propagationCase of world.cases) {
			const selected = await selector({ world, propagationCase });
			cases.push(scoreCase(world, propagationCase, selected, cap));
		}
	}

	return {
		cap,
		cases,
		meanRecall: mean(cases.map((c) => c.recall)),
		meanRecallAtCap: mean(cases.map((c) => c.recallAtCap)),
		meanFalsePositiveRate: mean(cases.map((c) => c.falsePositiveRate)),
		meanOrderingScore: mean(cases.map((c) => c.orderingScore)),
		totalFalsePositives: cases.reduce((sum, c) => sum + c.falsePositives.length, 0)
	};
}
