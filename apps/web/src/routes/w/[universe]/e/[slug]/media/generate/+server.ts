/**
 * #64-#67, #70, #71: the "Generate" action of the F1 = C confirm dialog. Always spends
 * (or reuses the similarity cache) - the dialog itself is what makes every paid action
 * confirmed (decision G11); this endpoint trusts the feature it is given rather than
 * re-deciding it, exactly like a payment endpoint trusts the amount a confirmed checkout
 * screen already showed the user.
 *
 * #255: `instruction` and `fromAssetId` are optional - present together, they turn this
 * into a regeneration (see @canonry/media's generate.ts for the prompt/cache reasoning).
 * Both are read, type-checked and handed straight through; this route does no more with
 * `instruction` than pass it on as a string, which is the whole point of treating it as
 * data rather than something to interpret.
 *
 * Always the real Replicate provider - never a fake wired in behind a flag. Without a
 * REPLICATE_API_TOKEN this throws MissingReplicateEnvError rather than falling back to
 * anything; see $lib/server/media.ts's header and this package's own report for why that is
 * the honest behaviour. With one it really generates: #258 drove this endpoint end to end
 * against Replicate, and the 2560x1440 seedream-4 scene it returned is in that PR.
 */
import { error, json } from '@sveltejs/kit';
import { InsufficientCreditsError } from '@canonry/ai';
import {
	AiDisabledError,
	ImageAspectRatioUnsupportedError,
	ImageModelNotConfiguredError,
	MediaAssetHasNoPromptError,
	MediaAssetNotOwnedError,
	UnsupportedImageFeatureError,
	generateImages
} from '@canonry/media';
import { stripMentionSyntax } from '$lib/markdown';
import { messages } from '$lib/i18n';
import {
	embeddingProviderFor,
	imageProvider,
	mediaStorage,
	similarityDeps
} from '$lib/server/media';
import type { RequestHandler } from './$types';
import { loadMediaContext, requireWriter } from '../_context.js';

/** Every value of `image_feature` is a real, configured feature since #258 seeded `scene`,
 * so this guard is now the enum and not a subset of it. It stays a guard rather than a cast:
 * the body is JSON a client sent, and `generateImages` charges for whatever it is handed. */
function isImageFeature(value: unknown): value is 'portrait' | 'variants' | 'scene' {
	return value === 'portrait' || value === 'variants' || value === 'scene';
}

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);
	requireWriter(locals, context.role);

	const body: unknown = await request.json();
	const feature =
		typeof body === 'object' && body !== null && 'feature' in body ? body.feature : undefined;
	if (!isImageFeature(feature)) {
		error(400, messages(locals.locale).entry.errors.featureInvalid);
	}

	const instruction =
		typeof body === 'object' && body !== null && 'instruction' in body
			? body.instruction
			: undefined;
	if (instruction !== undefined && typeof instruction !== 'string') {
		error(400, messages(locals.locale).entry.media.regenerate.instructionMustBeString);
	}

	const fromAssetId =
		typeof body === 'object' && body !== null && 'fromAssetId' in body
			? body.fromAssetId
			: undefined;
	if (fromAssetId !== undefined && typeof fromAssetId !== 'string') {
		error(400, messages(locals.locale).entry.media.regenerate.fromAssetIdMustBeString);
	}

	try {
		const result = await generateImages({
			db: context.conn,
			images: imageProvider(),
			embeddings: embeddingProviderFor(context.userId, context.universe.id),
			storage: mediaStorage(),
			similarity: await similarityDeps(),
			universeId: context.universe.id,
			aiEnabled: context.universe.aiEnabled,
			entity: {
				id: context.entity.id,
				name: context.entity.name,
				description: stripMentionSyntax(context.entity.body)
			},
			feature,
			userId: context.userId,
			instruction,
			fromAssetId
		});

		return json({
			reusedFromCache: result.reusedFromCache,
			model: { provider: result.model.provider, modelId: result.model.modelId },
			assets: result.assets.map((asset) => ({
				id: asset.id,
				mimeType: asset.mimeType,
				generated: asset.generated,
				credits: asset.credits
			}))
		});
	} catch (err) {
		if (err instanceof AiDisabledError) {
			error(409, messages(locals.locale).entry.errors.generationOff);
		}
		if (err instanceof InsufficientCreditsError) {
			error(402, messages(locals.locale).entry.errors.notEnoughCredits);
		}
		if (err instanceof MediaAssetNotOwnedError) {
			error(404, messages(locals.locale).entry.errors.noSuchGeneratedImage);
		}
		if (err instanceof MediaAssetHasNoPromptError) {
			error(400, messages(locals.locale).entry.media.regenerate.sourceHasNoPrompt);
		}
		// All three are misconfiguration a GM cannot fix and must not be told to retry: the
		// feature has no row, no priced operation, or (#332) a shape the configured model does
		// not accept. The message goes through rather than a generic 500 because it names the
		// row and the value, which is the whole point of refusing instead of generating at the
		// model's default.
		if (
			err instanceof ImageModelNotConfiguredError ||
			err instanceof UnsupportedImageFeatureError ||
			err instanceof ImageAspectRatioUnsupportedError
		) {
			error(500, err.message);
		}
		throw err;
	}
};
