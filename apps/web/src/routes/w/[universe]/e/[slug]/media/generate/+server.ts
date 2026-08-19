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
 * Always the real Replicate provider - never a fake wired in behind a flag. This box has
 * no REPLICATE_API_TOKEN, so this throws MissingReplicateEnvError until one is
 * configured; see $lib/server/media.ts's header and this package's own report for why
 * that is the honest behaviour rather than a silent, fabricated fallback.
 */
import { error, json } from '@sveltejs/kit';
import { InsufficientCreditsError } from '@canonry/ai';
import {
	AiDisabledError,
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

function isImageFeature(value: unknown): value is 'portrait' | 'variants' {
	return value === 'portrait' || value === 'variants';
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
		if (
			err instanceof ImageModelNotConfiguredError ||
			err instanceof UnsupportedImageFeatureError
		) {
			error(500, err.message);
		}
		throw err;
	}
};
