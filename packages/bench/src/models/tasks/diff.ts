/**
 * Task `diff`, purpose `premium`: the paragraph a GM reads and accepts or rejects.
 *
 * This is the call SPEC.md §5.1 reserves the expensive model for, and it is where the
 * product's first guardrail is actually tested. `writeEntityDiff` gives the model the
 * target entry's real body plus the evidence retrieval found, and nothing else, so
 * everything in the output either traces to that or was invented. The judge's
 * `inventedClaims` list is therefore not a style note, it is the pass or fail.
 *
 * The setup is deliberately deterministic on everything except the premium call. The
 * candidate pool and its evidence come from `loadCandidateGraph` plus `buildCandidatePool`
 * against the seeded corpus world, exactly as production builds them, and the plan
 * rationale is a fixed string rather than a cheap-model output, so two premium candidates
 * see byte-identical input. Benching a premium model on top of a cheap model's varying
 * plan would measure the pair.
 */
import {
	buildCandidatePool,
	loadCandidateGraph,
	scoreCandidates,
	semanticDiff,
	writeEntityDiff,
	type CandidateEvidence
} from '@canonry/copilot';
import { resolveModel } from '@canonry/ai';
import { canonLanguageFor, detectLanguage, type Locale } from '@canonry/lang';
import { PROPAGATION_EDITS } from '../../corpus/gold.js';
import { idsForSlugs } from '../../corpus/seed.js';
import { benchFixture } from '../../fixture.js';
import { benchModelFactory, identityGateway } from '../factory.js';
import { judgeOutput } from '../judge.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';
import { usageSince } from '../runner.js';

function describeEvidence(evidence: CandidateEvidence[]): string {
	return evidence
		.map((e) => {
			if (e.kind === 'relation') return `relation: ${e.path.join(' then ')} (${e.hops} hop)`;
			if (e.kind === 'mention') return `mention (${e.direction}): "${e.sourceSentence}"`;
			return `embedding similarity ${e.similarity.toFixed(2)}: "${e.sourceSentence}"`;
		})
		.join('\n');
}

export const diffTask: BenchTask = {
	id: 'diff',
	purpose: 'premium',
	measures:
		'writes the propagated update to one entry from its own body plus the evidence, judged for grounding, usefulness and craft',
	caseIds: () => PROPAGATION_EDITS.flatMap((edit) => edit.targets.map((t) => `${edit.id}/${t}`)),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const [editId, targetSlug] = caseId.split('/');
		const edit = PROPAGATION_EDITS.find((e) => e.id === editId);
		if (!edit || !targetSlug) throw new Error(`no diff case ${caseId}`);

		const fixture = await benchFixture(ctx.db);
		const graph = await loadCandidateGraph(ctx.db, fixture.universeId);
		const ids = await idsForSlugs(ctx.db, fixture.universeId, [edit.editedEntitySlug, targetSlug]);
		const edited = graph.entities.find((e) => e.id === ids.get(edit.editedEntitySlug));
		const targetEntity = graph.entities.find((e) => e.id === ids.get(targetSlug));
		if (!edited) throw new Error(`diff case ${caseId}: no entity ${edit.editedEntitySlug}`);
		if (!targetEntity) throw new Error(`diff case ${caseId}: no entity ${targetSlug}`);

		const diff = semanticDiff(edited.body, edit.newBody);
		const pool = scoreCandidates(buildCandidatePool(graph, edited.id, diff), []);
		const entry = pool.find((c) => c.entityId === targetEntity.id);
		const evidence: CandidateEvidence[] = entry?.evidence ?? [];

		// SPEC.md §17 rule three: the drafted paragraph follows the target entry's own
		// language, never the reader's, and `canonLanguageFor` is the product's own
		// resolution of that. Passing it rather than hardcoding 'en' is what makes the
		// Italian entries in the corpus a real test of the model instead of decoration.
		const locale: Locale = 'en';
		const contentLanguage = canonLanguageFor({
			targetLanguage: targetEntity.language,
			targetBody: targetEntity.body,
			triggerLanguage: edited.language,
			triggerBody: edit.newBody
		});

		const resolved = await resolveModel(ctx.db, 'premium');
		const started = Date.now();
		const since = new Date(started - 1000);

		const written = await writeEntityDiff({
			db: ctx.db,
			userId: fixture.userId,
			universeId: fixture.universeId,
			targetEntityName: targetEntity.name,
			targetEntityBody: targetEntity.body,
			planRationale: edit.planRationale,
			evidence,
			editedEntityName: edited.name,
			diff,
			model: { languageModel: identityGateway(benchModelFactory(resolved)), resolved },
			locale,
			contentLanguage
		});
		const latencyMs = Date.now() - started;
		const usage = await usageSince(ctx.db, since, resolved.provider, resolved.modelId);

		const judged = await judgeOutput({
			instruction:
				`Rewrite the entry "${targetEntity.name}" so it accounts for a change made to ` +
				`"${edited.name}". Change only what the change forces; keep everything else as it is. ` +
				`Write the new body in ${contentLanguage} and the one-line summary in ${locale}.`,
			context: [
				`### Current body of ${targetEntity.name}`,
				targetEntity.body,
				`### What changed on ${edited.name}`,
				diff.map((c) => `${c.kind}: ${c.statement}`).join('\n'),
				'### Evidence retrieval found',
				describeEvidence(evidence) || '(none)',
				'### Why this entry is on the plan',
				edit.planRationale
			].join('\n\n'),
			output: `summary: ${written.patch.summary}\n\nafter:\n${written.patch.after}`,
			extra:
				'A diff that rewrites paragraphs the change does not touch scores low on craft even if ' +
				'the new prose is good: the GM has to read the whole thing to find what moved. Losing ' +
				`the source language is a craft failure too: the body must stay in ${contentLanguage}.`
		});

		const bodyLanguage = detectLanguage(written.patch.after);
		const languageOk = bodyLanguage === null || bodyLanguage === contentLanguage;
		// A patch whose `after` is identical to `before` is not a diff, and one that dropped
		// most of the entry is a rewrite. Both are visible without a judge, so they are
		// scored without one.
		const unchanged = written.patch.after.trim() === targetEntity.body.trim();
		const shrinkRatio = written.patch.after.length / Math.max(1, targetEntity.body.length);
		const structurallySane = !unchanged && shrinkRatio > 0.5;

		const score = judged.score * (languageOk ? 1 : 0.5) * (structurallySane ? 1 : 0.4);

		return {
			caseId,
			ok: written.patch.after.trim().length > 0,
			score,
			detail: {
				summary: written.patch.summary,
				after: written.patch.after,
				evidenceCount: evidence.length,
				contentLanguage,
				bodyLanguage,
				languageOk,
				unchanged,
				shrinkRatio,
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
