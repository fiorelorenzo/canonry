/**
 * Ambient layer decomposition (#68, SPEC.md §8.2: "set-ambient-sound decomposes a
 * description into layers (continuous / oneshot / interval) with generateObject").
 * Reused close to verbatim from ai-game's set-ambient-sound.ts: the same three layer
 * kinds, the same system prompt shape, the same cheap-model routing (SPEC.md §5.1's
 * "a cheap model finds and ranks candidates" applies just as well to "a cheap model
 * decides how many sounds a scene needs").
 *
 * Priced at zero (migration 0017, operation 'audio.layers_parse'): what SPEC.md §8.1
 * anchors a cost to is each resulting layer's generation, not the sentence that decides
 * how many there will be - charging both would double-bill the same decision and make a
 * two-layer pack cost more per layer than a five-layer one. Still recorded through
 * withQuota rather than skipped, because H1 (docs/design/DECISIONS.md) closed exactly that
 * hole: a zero-credit call still records its real tokens and cost, nowhere else.
 */
import { generateObject, type LanguageModel } from 'ai';
import { resolveModel, withQuota } from '@canonry/ai';
import type { Db } from '@canonry/db';
import { z } from 'zod';

export const AMBIENT_LAYERS_OPERATION = 'audio.layers_parse';

// Exported so tools.test.ts-style JSON Schema regression coverage (issue #293, guard
// extended from #269's packages/import/src/tools.test.ts) can reach it directly rather
// than exercising it only through parseAmbientLayers.
export const layerSchema = z.object({
	layers: z
		.array(
			z.object({
				prompt: z
					.string()
					.describe(
						'Concise SFX generation prompt for this layer, e.g. "gentle rain falling on leaves", ' +
							'"distant thunder rumble". Focused on the sound itself, never the scene context.'
					),
				loopType: z
					.enum(['continuous', 'oneshot', 'interval'])
					.describe(
						'continuous: steady background (rain, wind, fire). oneshot: plays once. interval: ' +
							'repeats at random intervals (thunder, bird chirp, wolf howl).'
					),
				// Required + nullable rather than `.optional()` (issue #293, same root cause as
				// #269 but a different shape than its fix): these two are genuinely conditional
				// on `loopType`, not naturally empty, so making them plainly required with no
				// value would be a lie the way #269's `aliases`/`images` -> required swap wasn't.
				// `.optional()` still drops a property out of the JSON Schema's `required` array
				// exactly like `.default()` does, and OpenAI's structured-output mode rejects any
				// object schema whose properties are not all listed there. `.nullable()` is
				// OpenAI's own documented way to emulate an optional field: the key is always
				// present, `null` when `loopType` isn't 'interval', a real number when it is.
				intervalMinSeconds: z
					.number()
					.nullable()
					.describe(
						'Minimum seconds between plays. Required (non-null) for interval type, null otherwise.'
					),
				intervalMaxSeconds: z
					.number()
					.nullable()
					.describe(
						'Maximum seconds between plays. Required (non-null) for interval type, null otherwise.'
					),
				volume: z
					.number()
					.min(0)
					.max(1)
					.describe(
						'Per-layer volume 0-1. Primary sounds ~0.7-0.8, background textures ~0.3-0.5, accents ~0.4-0.6.'
					)
			})
		)
		.min(1)
});

const AMBIENT_LAYERS_SYSTEM_PROMPT = `You decompose an ambient soundscape description into individual audio layers for sound generation.

## Layer types
- continuous: steady background sounds that loop seamlessly (rain, wind, flowing water, fire crackling, crowd murmur)
- oneshot: one-time sounds that play once (a single bell toll, a door closing)
- interval: sounds that repeat at random intervals (thunder claps, bird chirps, wolf howls, dripping water, creaking wood)

## Guidelines
- Use as many layers as needed to faithfully recreate the soundscape
- Each layer is a SINGLE, distinct sound that can be generated independently - never combine multiple sounds into one layer
- For interval layers, set realistic intervals (thunder: 15-45s, bird chirps: 5-15s, dripping: 3-8s)
- Volume reflects the sound's prominence in the scene
- Prompts are specific and describe the sound itself, not the scene it belongs to`;

export interface ParsedAmbientLayer {
	prompt: string;
	loopType: 'continuous' | 'oneshot' | 'interval';
	intervalMinSeconds: number | null;
	intervalMaxSeconds: number | null;
	volume: number;
}

/**
 * Builds a real AI SDK model from a `model_config` row - the composition root
 * @canonry/ai's createLanguageModel now is. Injected rather than imported directly so
 * this module (and its tests) never depend on which providers that composition root
 * knows how to construct.
 */
export type LanguageModelFactory = (provider: string, modelId: string) => LanguageModel;

export interface ParseAmbientLayersInput {
	db: Db;
	languageModel: LanguageModelFactory;
	description: string;
	userId: string;
	universeId: string;
}

/** Decomposes one ambient description into layers through the 'cheap' purpose model,
 * charged (at zero credits) as 'audio.layers_parse'. Throws whatever withQuota/
 * generateObject throw - AiDisabledError-equivalent gating (is generation switched off
 * for this universe) is the caller's job, exactly like generate.ts's generateImages,
 * since that check has nothing to do with layer parsing specifically. */
export async function parseAmbientLayers(
	input: ParseAmbientLayersInput
): Promise<ParsedAmbientLayer[]> {
	const model = await resolveModel(input.db, 'cheap');
	const languageModel = input.languageModel(model.provider, model.modelId);

	const result = await withQuota(
		input.db,
		model,
		{
			userId: input.userId,
			universeId: input.universeId,
			agent: 'media',
			operation: AMBIENT_LAYERS_OPERATION
		},
		() =>
			generateObject({
				model: languageModel,
				schema: layerSchema,
				system: AMBIENT_LAYERS_SYSTEM_PROMPT,
				prompt: `Decompose this ambient soundscape into layers:\n\n${input.description}`
			}),
		{
			extractUsage: (result) => ({
				inputTokens: result.usage.inputTokens ?? 0,
				outputTokens: result.usage.outputTokens ?? 0
			})
		}
	);

	return result.object.layers;
}
