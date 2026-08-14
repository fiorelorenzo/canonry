/**
 * Real production wiring for the "+ NPC here" quick action's slow lane (SPEC.md §8: "the
 * NPC itself drafts in the slow lane, 3-10s, always background, always optional"). This is
 * the one place table mode calls a model at all - the instant and fast lanes (#73, #75)
 * never do.
 *
 * `createLanguageModel` (packages/ai/src/composition.ts) is the composition root that maps
 * a `model_config` row to a real, gateway-wrapped AI SDK model; `withQuota` prices and
 * records the call against `warm.npc_draft` (seeded in `operation_price` at 1 credit) and
 * refuses to run the generator at all if the balance cannot cover it. Everything here is
 * exactly the pattern `packages/copilot/src/diffs.ts` already uses for propagation diffs -
 * same `generateObject` + `withQuota` shape, different prompt.
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import { withQuota, type ResolvedModel } from '@canonry/ai';
import type { Db } from '@canonry/db';
import type { LanguageModel } from 'ai';
import type { WarmCandidate, WarmGenerationResult, WarmGenerator } from '@canonry/warm';

const npcDraftSchema = z.object({
	name: z.string().describe('A full name fitting the setting, never a placeholder like "NPC".'),
	aliases: z.array(z.string()).default([]),
	body: z
		.string()
		.describe('Two or three sentences: a role, a trait, a reason the party might talk to them.')
});

export interface NpcDraftGeneratorInput {
	db: Db;
	userId: string;
	placeName: string;
	resolved: ResolvedModel;
	languageModel: LanguageModel;
}

/** Builds the `WarmGenerator` `regenerate()` calls if (and only if) the candidate's
 * fingerprint is not already fresh. Throws whatever `withQuota`/`generateObject` throw -
 * `ModelNotConfiguredError` never reaches this point (the caller resolves the model before
 * building this), but a gateway auth failure, a missing credential, or an insufficient
 * balance all surface here, and the caller decides what a GM sees when that happens.
 */
export function buildNpcDraftGenerator(input: NpcDraftGeneratorInput): WarmGenerator {
	return async (candidate: WarmCandidate): Promise<WarmGenerationResult> => {
		const result = await withQuota(
			input.db,
			input.resolved,
			{
				userId: input.userId,
				universeId: candidate.universeId,
				agent: 'warm',
				operation: 'warm.npc_draft'
			},
			() =>
				generateObject({
					model: input.languageModel,
					schema: npcDraftSchema,
					system:
						'You are the Loremaster, sketching one candidate NPC a GM might improvise at a ' +
						'place in their world, for the GM to accept or discard. Keep it short: a name, a ' +
						'role, one trait, one reason to talk to the party. Never invent a detail that ' +
						'contradicts anything you are given, and never claim this NPC already exists in ' +
						'the world - it is a draft.',
					prompt: `Place: ${input.placeName}.\n${candidate.rationale ?? ''}`
				}),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		);

		return {
			payload: { name: result.object.name, body: result.object.body },
			draftEntity: {
				name: result.object.name,
				type: 'character',
				body: result.object.body,
				aliases: result.object.aliases,
				evidence: {
					source: 'table-quick-action',
					action: '+ NPC here',
					placeName: input.placeName
				}
			}
		};
	};
}
