/**
 * Task `complete`, purpose `premium`: SPEC.md §5's "Complete" mode, an entry that is thin
 * and a copilot that offers the missing fields with evidence.
 *
 * Unlike `diff`, this runs the whole shipped function, `completeEntry`, because the
 * evidence gathering is part of what makes the output good or bad and there is no seam
 * worth inserting between them. That means each case writes a real `proposal_plan` and a
 * real `proposal` row, which is the point: the bench leaves behind exactly the rows the
 * review screen reads, so a run doubles as the end-to-end exercise of the complete flow.
 *
 * The cases are entries the corpus deliberately leaves thin, listed in `gold.ts` as
 * `THIN_ENTRIES`. Two of them are Italian, because rule three of SPEC.md §17 says the
 * draft follows the entry's own language and a model that quietly completes an Italian
 * entry in English has failed regardless of how good the English is.
 */
import { completeEntry } from '@canonry/copilot';
import { detectLanguage } from '@canonry/lang';
import { THIN_ENTRIES } from '../../corpus/gold.js';
import { idsForSlugs } from '../../corpus/seed.js';
import { benchFixture } from '../../fixture.js';
import { benchModelFactory, identityGateway } from '../factory.js';
import { judgeOutput } from '../judge.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';
import { usageSince } from '../runner.js';
import { resolveModel } from '@canonry/ai';

export const completeTask: BenchTask = {
	id: 'complete',
	purpose: 'premium',
	measures:
		"drafts the missing content of a thin entry from its graph neighbourhood, judged, and checked against the entry's own language",
	caseIds: () => THIN_ENTRIES.map((t) => t.slug),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const thin = THIN_ENTRIES.find((t) => t.slug === caseId);
		if (!thin) throw new Error(`no thin entry ${caseId}`);

		const fixture = await benchFixture(ctx.db);
		const ids = await idsForSlugs(ctx.db, fixture.universeId, [caseId]);
		const entityId = ids.get(caseId);
		if (!entityId) throw new Error(`complete case ${caseId}: the seeded world has no such entry`);

		const resolved = await resolveModel(ctx.db, 'premium');
		const started = Date.now();
		const since = new Date(started - 1000);

		const result = await completeEntry({
			db: ctx.db,
			userId: fixture.userId,
			universeId: fixture.universeId,
			entityId,
			modelFactory: benchModelFactory,
			gateway: identityGateway,
			locale: 'en'
		});
		const latencyMs = Date.now() - started;
		const usage = await usageSince(ctx.db, since, resolved.provider, resolved.modelId);

		const patch = result.proposal.patch as { summary?: string; before?: string; after?: string };
		const after = patch.after ?? '';

		const judged = await judgeOutput({
			instruction:
				`The entry "${thin.name}" is thin. Draft what is missing, using only the entry itself ` +
				'and the evidence gathered from the entries around it. Do not invent people, places, ' +
				'dates or events the evidence does not carry.',
			context: [
				`### Current body of ${thin.name}`,
				patch.before ?? '(empty)',
				'### Evidence gathered from the graph',
				result.evidence.map((e) => `- ${JSON.stringify(e)}`).join('\n') || '(none)'
			].join('\n\n'),
			output: after,
			extra:
				`This entry is written in ${thin.language}. A draft in any other language is a craft ` +
				'failure however good it reads. What a GM wants here is the specific detail the ' +
				'neighbours already imply, not a paragraph of atmosphere that says nothing new.'
		});

		const drafted = detectLanguage(after);
		const languageOk = drafted === null || drafted === thin.language;
		// A "completion" that returns the entry unchanged, or shorter than it was, has not
		// completed anything.
		const grew = after.trim().length > (patch.before ?? '').trim().length;

		return {
			caseId,
			ok: after.trim().length > 0,
			score: judged.score * (languageOk ? 1 : 0.5) * (grew ? 1 : 0.3),
			detail: {
				summary: patch.summary,
				after,
				evidenceCount: result.evidence.length,
				expectedLanguage: thin.language,
				draftedLanguage: drafted,
				languageOk,
				grew,
				proposalId: result.proposal.id,
				judgeScore: judged.score,
				judgeDisagreement: judged.disagreement,
				judgeUnresolved: judged.unresolved,
				bothFoundInvention: judged.bothFoundInvention,
				eitherFoundInvention: judged.eitherFoundInvention,
				verdicts: judged.verdicts
			},
			latencyMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			costEur: usage.costEur
		};
	}
};
