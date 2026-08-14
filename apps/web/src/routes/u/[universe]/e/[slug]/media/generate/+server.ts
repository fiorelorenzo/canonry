/**
 * #64-#67, #70, #71: the "Generate" action of the F1 = C confirm dialog. Always spends
 * (or reuses the similarity cache) - the dialog itself is what makes every paid action
 * confirmed (decision G11); this endpoint trusts the feature it is given rather than
 * re-deciding it, exactly like a payment endpoint trusts the amount a confirmed checkout
 * screen already showed the user.
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
	UnsupportedImageFeatureError,
	generateImages
} from '@canonry/media';
import { stripMentionSyntax } from '$lib/markdown';
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
	requireWriter(context.role);

	const body: unknown = await request.json();
	const feature =
		typeof body === 'object' && body !== null && 'feature' in body ? body.feature : undefined;
	if (!isImageFeature(feature)) {
		error(400, 'feature must be "portrait" or "variants"');
	}

	try {
		const result = await generateImages({
			db: context.conn,
			images: imageProvider(),
			embeddings: embeddingProviderFor(context.userId, context.universe.id),
			storage: mediaStorage(),
			similarity: similarityDeps(),
			universeId: context.universe.id,
			aiEnabled: context.universe.aiEnabled,
			entity: {
				id: context.entity.id,
				name: context.entity.name,
				description: stripMentionSyntax(context.entity.body)
			},
			feature,
			userId: context.userId
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
			error(409, 'Generation is switched off for this universe.');
		}
		if (err instanceof InsufficientCreditsError) {
			error(402, 'Not enough credits to generate this image.');
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
