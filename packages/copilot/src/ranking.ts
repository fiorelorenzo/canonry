/**
 * The cheap model's job in issue #52 and SPEC.md §5.1 step 3: "a readable, editable plan
 * ... this change touches 4 entries, here is why." One `generateObject` call, charged as
 * `propagate.plan` (already priced in `operation_price`), covering the whole plan rather
 * than one call per candidate.
 *
 * What the model does and does not decide, deliberately split: `candidates.ts` and
 * `reject-signal.ts` already produced a deterministic, capped, ordered shortlist before
 * this file is ever called - the model writes the plan's summary sentence and each
 * candidate's short "why", and it may drop an entry it judges irrelevant by simply
 * omitting it from its response, but the `entityId` enum on the response schema makes it
 * structurally impossible for it to introduce a candidate retrieval never found. That is
 * the guardrail-3 boundary: every entry on the plan still traces back to real graph or
 * mention evidence, never to a model's unsupported invention.
 */
import { generateObject } from 'ai';
import { chargeFor, withQuota } from '@canonry/ai';
import { z } from 'zod';
import type { Db } from '@canonry/db';
import type { Locale } from '@canonry/lang';
import { EMPTY_PLAN_SUMMARY, speechInstruction } from './speech.js';
import type { FactChange } from './diff.js';
import type { RoutedModel } from './models.js';

export interface RankedCandidate {
	entityId: string;
	rationale: string;
}

export interface PlanRationale {
	summary: string;
	candidates: RankedCandidate[];
	provider: string;
	modelId: string;
	/** What this call cost the plan's estimate, from `operation_price.propagate.plan`. */
	credits: number;
}

export interface PlanCandidateInput {
	entityId: string;
	name: string;
}

export interface WritePlanRationaleInput {
	db: Db;
	userId: string;
	universeId: string;
	editedEntityName: string;
	diff: FactChange[];
	/** Deterministic order and cap already applied (candidates.ts + reject-signal.ts) -
	 * this is the shortlist the model may narrow, never one it can widen. */
	candidates: PlanCandidateInput[];
	model: RoutedModel;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever triggered this
	 * plan - the summary and every per-candidate rationale are written in this, never in
	 * the language of the edited entry or its candidates. */
	locale: Locale;
	requestId?: string;
}

function buildSchema(entityIds: string[]) {
	return z.object({
		summary: z.string().min(1),
		candidates: z.array(
			z.object({
				entityId: z.enum(entityIds as [string, ...string[]]),
				rationale: z.string().min(1)
			})
		)
	});
}

/** issue #50: the readable, editable plan. An empty shortlist never reaches the model -
 * there is nothing to rank or explain, and charging for a no-op call would be exactly the
 * invisible spend SPEC.md §15 rules out. */
export async function writePlanRationale(input: WritePlanRationaleInput): Promise<PlanRationale> {
	if (input.candidates.length === 0) {
		return {
			summary: EMPTY_PLAN_SUMMARY[input.locale](input.editedEntityName),
			candidates: [],
			provider: input.model.resolved.provider,
			modelId: input.model.resolved.modelId,
			credits: 0
		};
	}

	const entityIds = input.candidates.map((c) => c.entityId);
	const schema = buildSchema(entityIds);
	const changesText = input.diff.map((c) => `${c.kind}: ${c.statement}`).join('\n');
	const candidatesText = input.candidates.map((c) => `- ${c.entityId}: ${c.name}`).join('\n');

	const [result, price] = await Promise.all([
		withQuota(
			input.db,
			input.model.resolved,
			{
				userId: input.userId,
				universeId: input.universeId,
				agent: 'propagate',
				operation: 'propagate.plan',
				...(input.requestId !== undefined
					? { requestId: input.requestId, idempotencyKey: input.requestId }
					: {})
			},
			() =>
				generateObject({
					model: input.model.languageModel,
					schema,
					system:
						'You are the Loremaster propagation planner for a tabletop RPG wiki. Given what ' +
						'changed on one entry and a shortlist of candidate entries it might touch, write one ' +
						'short sentence summarising the plan and one short, concrete rationale per candidate ' +
						'explaining why that specific entry is affected. Drop a candidate from your response ' +
						'if it genuinely does not matter; never invent a candidate outside the shortlist. ' +
						speechInstruction(input.locale),
					prompt: `Entry edited: ${input.editedEntityName}\n\nWhat changed:\n${changesText}\n\nCandidate entries (id: name):\n${candidatesText}`
				}),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		),
		chargeFor(input.db, 'propagate.plan')
	]);

	const rationaleById = new Map(result.object.candidates.map((c) => [c.entityId, c.rationale]));
	const candidates: RankedCandidate[] = input.candidates
		.filter((c) => rationaleById.has(c.entityId))
		.map((c) => ({ entityId: c.entityId, rationale: rationaleById.get(c.entityId)! }));

	return {
		summary: result.object.summary,
		candidates,
		provider: input.model.resolved.provider,
		modelId: input.model.resolved.modelId,
		credits: price.credits
	};
}
