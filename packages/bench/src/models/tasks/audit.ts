/**
 * Task `audit`, purpose `cheap`: does this model know when two statements disagree, and
 * more importantly does it know when they do not.
 *
 * SPEC.md §5.2 and guardrail 7 make this the most dangerous cheap-model call in the
 * product. An audit flag is shown to a GM as "these two entries do not agree on X", and
 * the product is explicitly forbidden from ever certifying the opposite. A model that
 * flags freely turns the audit into noise the GM learns to dismiss, which is worse than no
 * audit, and SPEC.md §14 already records the state of the art at roughly 52% F1 on
 * contradiction detection. So the corpus is built half and half, and the ten
 * non-disagreeing pairs are deliberately hard: same two entries, same subject, facts that
 * sit beside each other rather than against each other.
 *
 * Scored as balanced accuracy rather than plain accuracy, because a model that answers
 * "disagree" to everything would score 50% on plain accuracy and look mediocre rather than
 * useless. Balanced accuracy over a 10/10 split gives the same 0.5 for the all-yes model
 * and the all-no model, and the report prints the two error rates separately so the shape
 * of a model's mistakes is visible rather than averaged away.
 */
import { judgeStatementPair, isGuardrailSafeTopic } from '@canonry/copilot';
import { resolveModel } from '@canonry/ai';
import { AUDIT_PAIRS } from '../../corpus/gold.js';
import { benchFixture } from '../../fixture.js';
import { benchModelFactory, identityGateway } from '../factory.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';
import { usageSince } from '../runner.js';

export const auditTask: BenchTask = {
	id: 'audit',
	purpose: 'cheap',
	measures:
		'judges whether two statements from different entries disagree, against twenty labelled pairs, half of them deliberately compatible',
	caseIds: () => AUDIT_PAIRS.map((p) => p.id),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const pair = AUDIT_PAIRS.find((p) => p.id === caseId);
		if (!pair) throw new Error(`no audit pair ${caseId}`);

		const fixture = await benchFixture(ctx.db);
		const resolved = await resolveModel(ctx.db, 'cheap');
		const started = Date.now();
		const since = new Date(started - 1000);

		const judged = await judgeStatementPair({
			db: ctx.db,
			userId: fixture.userId,
			universeId: fixture.universeId,
			model: { languageModel: identityGateway(benchModelFactory(resolved)), resolved },
			locale: 'en',
			a: { entityName: pair.aEntity, statement: pair.aStatement },
			b: { entityName: pair.bEntity, statement: pair.bStatement }
		});
		const latencyMs = Date.now() - started;
		const usage = await usageSince(ctx.db, since, resolved.provider, resolved.modelId);

		const correct = judged.disagree === pair.disagree;
		// Guardrail 7 is checked in code before a topic ever reaches a rationale
		// (`isGuardrailSafeTopic`), so a model whose topics keep tripping it is producing
		// flags the product then has to strip down to the bare template. That is a real
		// quality difference between two models with the same accuracy, so it is scored.
		const topicSafe = !judged.disagree || isGuardrailSafeTopic(judged.topic);
		const topicUseful = !judged.disagree || judged.topic.trim().split(/\s+/).length >= 3;

		let score = 0;
		if (correct) score = 0.7;
		if (correct && topicSafe) score += 0.2;
		if (correct && topicUseful) score += 0.1;

		return {
			caseId,
			ok: true,
			score,
			detail: {
				expected: pair.disagree,
				answered: judged.disagree,
				topic: judged.topic,
				topicSafe,
				topicUseful,
				note: pair.note,
				// Kept per case so the aggregate can be recomputed as balanced accuracy without
				// re-reading the corpus alongside the results file.
				labelledDisagree: pair.disagree
			},
			latencyMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			costEur: usage.costEur
		};
	}
};

export interface AuditErrorProfile {
	balancedAccuracy: number;
	/** Flagged a pair that does not disagree. The noise error, the expensive one here. */
	falseFlagRate: number;
	/** Missed a pair that does disagree. */
	missRate: number;
}

/** Recomputes the two error rates from a finished run's case details, which the report
 * prints next to the mean score: two models can share a mean and fail in opposite
 * directions, and only one of those directions makes the audit unusable. */
export function auditErrorProfile(cases: CaseOutcome[]): AuditErrorProfile {
	let positives = 0;
	let negatives = 0;
	let missed = 0;
	let falseFlags = 0;
	for (const c of cases) {
		const expected = c.detail.labelledDisagree === true;
		const answered = c.detail.answered === true;
		if (expected) {
			positives++;
			if (!answered) missed++;
		} else {
			negatives++;
			if (answered) falseFlags++;
		}
	}
	const sensitivity = positives === 0 ? 0 : (positives - missed) / positives;
	const specificity = negatives === 0 ? 0 : (negatives - falseFlags) / negatives;
	return {
		balancedAccuracy: (sensitivity + specificity) / 2,
		falseFlagRate: negatives === 0 ? 0 : falseFlags / negatives,
		missRate: positives === 0 ? 0 : missed / positives
	};
}
