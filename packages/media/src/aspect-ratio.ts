/**
 * Which aspect ratios each image model actually accepts, and the check that refuses to send
 * one it does not (#332).
 *
 * The shape a feature wants is configuration, not code: it lives in
 * `image_model_config.params.aspectRatio` next to the model that has to honour it (see
 * models.ts). What cannot live there is whether the model on that same row will accept the
 * value, because that is the model's own schema and an admin swapping a model from
 * /admin/models has no way to know it. This module is that knowledge, written down per model
 * id, so a swap fails loudly instead of quietly reverting to whatever the new model defaults
 * to - which is exactly the defect #332 is: `prunaai/p-image` defaults to 16:9, nothing ever
 * said otherwise, and every portrait this product generated came back a landscape.
 *
 * Each list is the model's own `aspect_ratio` enum, read from Replicate on 2026-08-19:
 *
 *     curl -s -H "authorization: Bearer $REPLICATE_API_TOKEN" \
 *       https://api.replicate.com/v1/models/<owner>/<name> \
 *       | jq '.latest_version.openapi_schema.components.schemas.aspect_ratio.enum'
 *
 * A model that is not listed here is not a model whose schema somebody read, and asking it
 * for a ratio is a guess with two silent failure modes: Replicate ignores an input key a
 * model's schema does not declare (`prunaai/p-image` has been receiving a `num_outputs` it
 * never declared since #66), and a model that takes `width`/`height` instead of
 * `aspect_ratio` at all - `stability-ai/sdxl` is the one I found while measuring #258 - reads
 * as accepted and returns whatever size it likes. Both look exactly like this bug. So an
 * unrecorded model refuses rather than guesses, and adding one is a curl and a line here.
 */

export const IMAGE_MODEL_ASPECT_RATIOS: Record<string, readonly string[]> = {
	// portrait (migration 0011) and every variants alternate have to agree on a shape, so
	// these two enums are read together: their intersection is what `portrait` can be set to.
	'prunaai/p-image': ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', 'custom'],
	'black-forest-labs/flux-schnell': [
		'1:1',
		'16:9',
		'21:9',
		'3:2',
		'2:3',
		'4:5',
		'5:4',
		'3:4',
		'4:3',
		'9:16',
		'9:21'
	],
	// scene (migration 0042). `match_input_image` is its default and means "copy the input
	// image", which a text-to-image call has none of, so the row states 16:9 explicitly.
	'bytedance/seedream-4': [
		'match_input_image',
		'1:1',
		'4:3',
		'3:4',
		'16:9',
		'9:16',
		'3:2',
		'2:3',
		'21:9'
	],
	// Not on any row today: a losing arm of #258's scene sweep, kept so re-running that
	// bench (or the portrait sweep #332 asks for) does not have to re-read a schema first.
	'black-forest-labs/flux-1.1-pro': [
		'custom',
		'1:1',
		'16:9',
		'3:2',
		'2:3',
		'4:5',
		'5:4',
		'9:16',
		'3:4',
		'4:3'
	]
};

/**
 * A configured aspect ratio the target model will not honour. Thrown rather than dropped on
 * purpose: dropping it is what "silently defaults back to 16:9" means, and a portrait that is
 * the wrong shape looks like a bad picture rather than a bad configuration, which is why this
 * went unnoticed from migration 0011 until #258 measured a sibling feature.
 */
export class ImageAspectRatioUnsupportedError extends Error {
	constructor(
		public readonly modelId: string,
		public readonly aspectRatio: string,
		public readonly accepted?: readonly string[]
	) {
		super(
			accepted
				? `image model "${modelId}" does not accept aspect ratio "${aspectRatio}" (it accepts ${accepted.join(', ')})`
				: `image model "${modelId}" has no recorded aspect_ratio enum, so asking it for "${aspectRatio}" cannot be verified: read the model's schema and add it to IMAGE_MODEL_ASPECT_RATIOS in @canonry/media`
		);
		this.name = 'ImageAspectRatioUnsupportedError';
	}
}

/** No aspect ratio configured is not an error: the row is then saying "leave the model's own
 * default alone", which is what every row said before migration 0045. */
export function assertAspectRatioSupported(modelId: string, aspectRatio: string | undefined): void {
	if (aspectRatio === undefined) return;
	const accepted = IMAGE_MODEL_ASPECT_RATIOS[modelId];
	if (accepted?.includes(aspectRatio)) return;
	throw new ImageAspectRatioUnsupportedError(modelId, aspectRatio, accepted);
}
