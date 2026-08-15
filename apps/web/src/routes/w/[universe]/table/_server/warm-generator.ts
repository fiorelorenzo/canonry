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
import { contentLanguageForSubject } from '@canonry/warm';
import type { WarmCandidate, WarmGenerationResult, WarmGenerator } from '@canonry/warm';
import { DEFAULT_LOCALE, type Locale } from '@canonry/lang';

/** Written out in English for the model rather than passed as a tag: "Italian" is a clearer
 * instruction to a language model than "it", and this is the only place the mapping is needed. */
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', it: 'Italian' };

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
	/** The place's own recorded language, and its body as a fallback when nobody set one. Read
	 * by `contentLanguageForSubject`, which by construction cannot reach for the reader's
	 * locale, so a caller that forgets these degrades to English canon rather than to whatever
	 * language the GM happens to be reading in. */
	placeLanguage: string | null;
	placeBody: string;
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
		// The reader's language, for the label. Absent means an older candidate row written before
		// SPEC.md §17: English is the honest default for speech, since nobody recorded a choice.
		const speechLocale: Locale = candidate.locale ?? DEFAULT_LOCALE;
		// The place's own language, for the prose. `contentLanguageForSubject` reads only the
		// subject entity's fields, so this can never fall back to the reader's locale by accident.
		const contentLanguage: Locale =
			candidate.contentLanguage ??
			contentLanguageForSubject({ language: input.placeLanguage, body: input.placeBody });
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
					// SPEC.md §17's two rules, in the one prompt where they are easiest to conflate.
					// The label a GM reads is speech and follows the interface locale; the NPC's own
					// prose lands inside canon and follows the place's language, which is why the two
					// are separate fields on the candidate rather than one. The fallback for the
					// content language is the subject entity's own language, never the reader's:
					// a caller that forgets to pass it degrades to the correct behaviour rather than
					// the convenient one.
					system:
						'You are the Loremaster, sketching one candidate NPC a GM might improvise at a ' +
						'place in their world, for the GM to accept or discard. Keep it short: a name, a ' +
						'role, one trait, one reason to talk to the party. Never invent a detail that ' +
						'contradicts anything you are given, and never claim this NPC already exists in ' +
						'the world - it is a draft.\n' +
						`Write the NPC's name, role, trait and hook in ${LANGUAGE_NAMES[contentLanguage]}, ` +
						"because this text becomes part of that place's entry and must match the " +
						'language already written there.\n' +
						`Address the GM in ${LANGUAGE_NAMES[speechLocale]}.\n` +
						'Never translate a proper noun: a place or person keeps the name it already has, ' +
						'whatever language the sentence around it is in.',
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
