/**
 * The premium model's job in issue #52 and SPEC.md §5.1 step 4: "one diff per entry, each
 * showing the source sentence and the relation it travelled along." One `generateObject`
 * call per surviving candidate, charged as `propagate.diff` (already priced in
 * `operation_price`) - deliberately per entry rather than batched, so a GM who drops half
 * the plan (issue #50) only ever pays for the diffs actually written.
 */
import { generateObject } from 'ai';
import { chargeFor, withQuota } from '@canonry/ai';
import { z } from 'zod';
import { relationTypesForUniverse, type Db } from '@canonry/db';
import type { Locale } from '@canonry/lang';
import { canonInstruction, speechInstruction } from './speech.js';
import type { CandidateEvidence } from './candidates.js';
import type { FactChange } from './diff.js';
import type { RoutedModel } from './models.js';
import { localizedRelationLabel, preferredRelationTypeByKey } from '@canonry/lang';

/** Shape of `proposal.patch` this package writes for an 'update' proposal - `proposals.ts`
 * in `@canonry/db` reads exactly these three fields when accepting one. `before` is a
 * snapshot for display (decision C4's diff view), not something accept re-derives, since
 * the entity may have moved on by the time a GM reviews it. */
export interface EntityUpdatePatch {
	summary: string;
	before: string;
	after: string;
}

export interface WrittenDiff {
	patch: EntityUpdatePatch;
	provider: string;
	modelId: string;
	credits: number;
}

export interface WriteEntityDiffInput {
	db: Db;
	userId: string;
	universeId: string;
	targetEntityName: string;
	targetEntityBody: string;
	/** Why this candidate is on the plan at all (issue #50's per-candidate rationale). */
	planRationale: string;
	/** Guardrail 3's evidence: what this diff has to be able to point at. */
	evidence: CandidateEvidence[];
	editedEntityName: string;
	diff: FactChange[];
	model: RoutedModel;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever triggered this
	 * propagation - `patch.summary` ("the reason it exists") is written in this. */
	locale: Locale;
	/** SPEC.md §17 rule three (issue #124), via `@canonry/lang`'s `canonLanguageFor` -
	 * `patch.after` ("the drafted paragraph") is written in this instead, deliberately
	 * never `locale`: a proposal legitimately carries both languages at once. */
	contentLanguage: Locale;
	requestId?: string;
}

const diffSchema = z.object({
	summary: z.string().min(1),
	after: z.string().min(1)
});

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
			return `${evidence.hops}-hop relation path: ${evidence.path.map(relationLabel).join(' -> ')}`;
		case 'mention':
			return `${evidence.direction} mention ("${evidence.matchedText}") in: "${evidence.sourceSentence}"`;
		case 'embedding':
			return `similar wording (similarity ${evidence.similarity.toFixed(2)}) in: "${evidence.sourceSentence}"`;
	}
}

/** issue #51: drafts one entry's full proposed new body. Guardrail 3 is enforced by what
 * the prompt is given, not by validating the response after the fact - the model only
 * ever sees the entity's real current body plus the evidence retrieval already found, so
 * it has nothing else to draw the new text from. */
export async function writeEntityDiff(input: WriteEntityDiffInput): Promise<WrittenDiff> {
	const changesText = input.diff.map((c) => `${c.kind}: ${c.statement}`).join('\n');
	// #197: `relationLabel` backs the interface-locale label for a shipped key, or the
	// authored label outright for a universe's own - see `describeEvidence`'s own comment.
	// `preferredRelationTypeByKey` resolves the ambiguity when a GM has reused a shipped
	// label for their own type (its key is then the same text, see that function's own
	// doc comment).
	const relationTypes = await relationTypesForUniverse(input.db, input.universeId);
	const relationTypesByKey = preferredRelationTypeByKey(relationTypes);
	const relationLabel = (key: string): string => {
		const type = relationTypesByKey.get(key);
		return type ? localizedRelationLabel(type, input.locale) : key;
	};
	const evidenceText = input.evidence.map((e) => describeEvidence(e, relationLabel)).join('\n');
	const [result, price] = await Promise.all([
		withQuota(
			input.db,
			input.model.resolved,
			{
				userId: input.userId,
				universeId: input.universeId,
				agent: 'propagate',
				operation: 'propagate.diff',
				...(input.requestId !== undefined
					? { requestId: input.requestId, idempotencyKey: input.requestId }
					: {})
			},
			() =>
				generateObject({
					model: input.model.languageModel,
					schema: diffSchema,
					system:
						'You are the Loremaster, drafting a proposed update to one wiki entry because a ' +
						"related entry just changed. Write the entry's full new body text, keeping " +
						'everything unrelated to this change untouched, and a one-line summary of what you ' +
						'changed and why. Only use facts the evidence below actually supports - never invent ' +
						'a detail the source sentence does not carry. The summary is addressed to the GM; ' +
						'the new body text is the entry itself - they are held to different language rules, ' +
						'stated separately below. ' +
						speechInstruction(input.locale) +
						' ' +
						canonInstruction(input.contentLanguage),
					prompt:
						`Entry to update: ${input.targetEntityName}\n\n` +
						`Current body:\n${input.targetEntityBody}\n\n` +
						`Why this entry is affected:\n${evidenceText}\n\n` +
						`What changed on ${input.editedEntityName}:\n${changesText}\n\n` +
						`Plan rationale: ${input.planRationale}`
				}),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		),
		chargeFor(input.db, 'propagate.diff')
	]);

	return {
		patch: {
			summary: result.object.summary,
			before: input.targetEntityBody,
			after: result.object.after
		},
		provider: input.model.resolved.provider,
		modelId: input.model.resolved.modelId,
		credits: price.credits
	};
}
