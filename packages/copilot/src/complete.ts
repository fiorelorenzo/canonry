/**
 * Complete (SPEC.md §5, issue #54): "an entry is thin -> proposes the missing fields with
 * evidence." A generation like any other (`entry.complete` is priced), so it lands in
 * `proposal` exactly like a propagation update - same `kind: 'update'`, same accept flow,
 * same instrumentation (SPEC.md §5's "one output shape").
 *
 * Evidence is gathered the same deterministic way propagation already trusts: graph
 * relations the entity participates in, plus every other entity's body that already
 * mentions this one (candidates.ts's own reverse-mention source) - what is already known
 * about a thin entry from the rest of the universe, not invented context. No retrieval
 * dependency: unlike Ask, a thin entry's missing content comes from its own graph
 * neighbourhood, which is already loaded for propagation and needs no Qdrant collection to
 * exist.
 */
import { chargeFor, resolveModel, withQuota } from '@canonry/ai';
import type { Db } from '@canonry/db';
import {
	createProposalPlan,
	recordProposalDiff,
	relationTypesForUniverse,
	setProposalPlanStatus
} from '@canonry/db';
import type { ProposalRow } from '@canonry/db';
import { canonLanguageFor, type Locale } from '@canonry/lang';
import { generateObject } from 'ai';
import { z } from 'zod';
import { mentionsIn } from './candidates.js';
import type { CandidateEvidence, GraphEntity, GraphRelationEdge } from './candidates.js';
import { loadCandidateGraph } from './db-graph.js';
import { splitIntoSentences } from './diff.js';
import { routeModel } from './models.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { requireAiEnabled } from './propagate.js';
import { canonInstruction, speechInstruction } from './speech.js';
import { localizedRelationLabel, preferredRelationTypeByKey } from '@canonry/lang';

export interface CompleteEntryInput {
	db: Db;
	userId: string;
	universeId: string;
	entityId: string;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever asked to
	 * complete this entry - `patch.summary` ("what you added and why") is written in
	 * this. */
	locale: Locale;
	requestId?: string;
}

export interface CompleteEntryResult {
	proposal: ProposalRow;
	evidence: CandidateEvidence[];
}

/** Every relation this entity is on either end of, as evidence for what the rest of the
 * universe already knows about it - the same shape `buildCandidatePool`'s relation source
 * uses, one hop, since a completion draws on direct facts rather than the wider 2-hop
 * impact radius propagation searches. `path` carries `relation_type.key` (decision L1,
 * #195), same as every other relation evidence path - identity, not the display word. */
function relationEvidence(entityId: string, relations: GraphRelationEdge[]): CandidateEvidence[] {
	return relations
		.filter((r) => r.fromId === entityId || r.toId === entityId)
		.map((r) => ({ kind: 'relation' as const, hops: 1, path: [r.key] }));
}

/** Every sentence in every other entity's body that already names this one - the same
 * reverse-mention source candidates.ts documents as catching what a formal relation row
 * would miss. */
function mentionEvidence(target: GraphEntity, others: GraphEntity[]): CandidateEvidence[] {
	const evidence: CandidateEvidence[] = [];
	for (const other of others) {
		for (const sentence of splitIntoSentences(other.body)) {
			const hit = mentionsIn(sentence, [target]);
			if (hit.length > 0) {
				evidence.push({
					kind: 'mention',
					direction: 'reverse',
					matchedText: hit[0]!.matchedText,
					sourceSentence: sentence
				});
			}
		}
	}
	return evidence;
}

// `evidence.path` is `relation_type.key` now, not the display label (decision L1, #195).
// This is model input, never shown to a GM directly, but SPEC.md §17 rule two still
// applies to it (#197): the copilot speaks the interface language in every prompt it
// builds, so `relationLabel` renders a shipped key in `input.locale`'s catalogue label
// and a universe's own key in whatever language its GM authored it in - never the raw
// key, which would read fine to nobody in particular.
function describeEvidence(
	evidence: CandidateEvidence,
	relationLabel: (key: string) => string
): string {
	switch (evidence.kind) {
		case 'relation':
			return `relation: ${evidence.path.map(relationLabel).join(' -> ')}`;
		case 'mention':
			return `mentioned elsewhere: "${evidence.sourceSentence}"`;
		case 'embedding':
			return `similar wording: "${evidence.sourceSentence}"`;
	}
}

const completeSchema = z.object({
	summary: z.string().min(1),
	after: z.string().min(1)
});

/** SPEC.md §5, issue #54: drafts the missing content for a thin entry from what the rest
 * of the universe already says about it, and writes it as a normal pending `update`
 * proposal (`createProposalPlan` then `recordProposalDiff`, the same two-step write
 * propagation's own diff phase uses) so it goes through the identical accept flow and
 * instrumentation as any other proposal. Guardrail 3 is enforced by what the prompt is
 * given, not by validating the response after the fact, exactly like `writeEntityDiff`:
 * the model sees only the entity's current body plus the evidence gathered here. */
export async function completeEntry(input: CompleteEntryInput): Promise<CompleteEntryResult> {
	await requireAiEnabled(input.db, input.universeId);

	const [graph, relationTypes] = await Promise.all([
		loadCandidateGraph(input.db, input.universeId),
		relationTypesForUniverse(input.db, input.universeId)
	]);
	const target = graph.entities.find((e) => e.id === input.entityId);
	if (!target) throw new Error(`completeEntry: unknown entity "${input.entityId}"`);
	// SPEC.md §17 rule three: no separate "triggering entry" exists for Complete (it is
	// invoked directly on one thin entry, not by another entity's edit) - the chain ends
	// at the target's own recorded language and body, English when even that is unknown,
	// deliberately never `input.locale`.
	const contentLanguage = canonLanguageFor({
		targetLanguage: target.language,
		targetBody: target.body
	});
	const others = graph.entities.filter((e) => e.id !== target.id);

	// #197: `relationTypesByKey` backs `relationLabel` below - the interface-locale label
	// for a shipped key, the authored label outright for a universe's own.
	// `preferredRelationTypeByKey` resolves the ambiguity when a GM has reused a shipped
	// label for their own type (its key is then the same text, see that function's own
	// doc comment).
	const relationTypesByKey = preferredRelationTypeByKey(relationTypes);
	const relationLabel = (key: string): string => {
		const type = relationTypesByKey.get(key);
		return type ? localizedRelationLabel(type, input.locale) : key;
	};

	const evidence: CandidateEvidence[] = [
		...relationEvidence(target.id, graph.relations),
		...mentionEvidence(target, others)
	];
	const evidenceText =
		evidence.length > 0
			? evidence.map((e) => describeEvidence(e, relationLabel)).join('\n')
			: '(none found)';

	const premiumModel = routeModel(
		await resolveModel(input.db, 'premium'),
		input.modelFactory,
		input.gateway
	);
	const [result, price] = await Promise.all([
		withQuota(
			input.db,
			premiumModel.resolved,
			{
				userId: input.userId,
				universeId: input.universeId,
				agent: 'loremaster',
				operation: 'entry.complete',
				...(input.requestId !== undefined
					? { requestId: input.requestId, idempotencyKey: input.requestId }
					: {})
			},
			() =>
				generateObject({
					model: premiumModel.languageModel,
					schema: completeSchema,
					system:
						'You are the Loremaster, filling in missing detail for a thin wiki entry in a ' +
						"tabletop RPG world. Write the entry's full new body text, keeping every existing " +
						'sentence unless it directly conflicts with the evidence, and a one-line summary of ' +
						'what you added and why. Only use facts the evidence below actually supports - never ' +
						'invent a detail no source carries. If the evidence is empty, make the smallest ' +
						'reasonable addition consistent with what is already written, or leave the body ' +
						'unchanged if nothing can be said with evidence. The summary is addressed to the ' +
						'GM; the new body text is the entry itself - different language rules apply to ' +
						'each, stated separately below. ' +
						speechInstruction(input.locale) +
						' ' +
						canonInstruction(contentLanguage),
					prompt:
						`Entry to complete: ${target.name}\n\n` +
						`Current body:\n${target.body || '(empty)'}\n\n` +
						`What the rest of the universe already says about ${target.name}:\n${evidenceText}`
				}),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		),
		chargeFor(input.db, 'entry.complete')
	]);

	const { plan, proposals } = await createProposalPlan(input.db, {
		universeId: input.universeId,
		trigger: 'complete',
		triggerEntityId: target.id,
		summary: result.object.summary,
		candidateCap: 1,
		estimatedCredits: price.credits,
		locale: input.locale,
		candidates: [
			{
				kind: 'update',
				targetEntityId: target.id,
				rationale: result.object.summary,
				evidence,
				rank: 0
			}
		]
	});
	const candidate = proposals[0];
	if (!candidate) throw new Error('completeEntry: createProposalPlan returned no proposal');

	const proposal = await recordProposalDiff(input.db, {
		proposalId: candidate.id,
		patch: { summary: result.object.summary, before: target.body, after: result.object.after },
		provider: premiumModel.resolved.provider,
		modelId: premiumModel.resolved.modelId,
		credits: price.credits
	});

	// Issue #345: this plan's one diff exists the moment the line above returns, so the plan
	// is spent, exactly as `draftEntityUpdate` in ask-propose.ts marks its own. Left at
	// `ready` the plan page showed C3's checklist for a candidate that already had its prose,
	// so reviewing a completion meant clicking "Generate diffs" (advertising a second charge
	// it would not actually make, since `generatePlanDiffs` skips a candidate that has a
	// patch) before the queue would even render the diff.
	await setProposalPlanStatus(input.db, plan.id, 'spent');

	return { proposal, evidence };
}
