/**
 * End-to-end portrait/variant generation (#64-#67, #70, #71). Resolves the active model
 * for the feature, builds the prompt from the entry plus its resolved style, checks the
 * similarity cache before spending anything, and otherwise generates through the
 * concurrency-limited provider, stores the files, and inserts unattached media_asset rows
 * for the GM to pick from.
 *
 * Guardrail 6 / #71: this function never sets `published_to_players`. createMediaAsset's
 * own schema default (false) is the only thing that ever decides that column's value -
 * there is no parameter here for a caller to pass true, on a cache hit or otherwise.
 */
import { randomUUID } from 'node:crypto';
import { chargeFor, type ResolvedModel } from '@canonry/ai';
import { createMediaAsset, mediaAssetsByIds, type Db, type MediaAssetRow } from '@canonry/db';
import type { ImageFeature } from '@canonry/db/schema';
import { composePrompt } from './prompt.js';
import { resolveStyle } from './style.js';
import { resolveImageModel } from './models.js';
import { findSimilarMedia, recordMediaVector, type SimilarityCacheDeps } from './similarity.js';
import type { EmbeddingProvider } from './embedding.js';
import type { ImageProvider } from './provider.js';
import type { MediaStorage } from './storage.js';

/** Guardrail 4 (SPEC.md §3.4): "the AI switch stops generation completely... what remains
 * is a good wiki." Checked first, before any model resolution or spend. */
export class AiDisabledError extends Error {
	constructor(universeId: string) {
		super(`universe "${universeId}" has generation switched off (AI off, guardrail 4)`);
		this.name = 'AiDisabledError';
	}
}

/** 'scene' exists in the image_feature enum for a later wave; SPEC.md §9 only names a
 * priced operation and a seeded model for portrait and its four-variant batch. */
export class UnsupportedImageFeatureError extends Error {
	constructor(feature: ImageFeature) {
		super(`image feature "${feature}" has no priced operation configured yet`);
		this.name = 'UnsupportedImageFeatureError';
	}
}

const OPERATION_BY_FEATURE: Partial<Record<ImageFeature, string>> = {
	portrait: 'image.portrait',
	variants: 'image.variants'
};

const IMAGE_COUNT_BY_FEATURE: Partial<Record<ImageFeature, number>> = {
	portrait: 1,
	variants: 4
};

export function operationForFeature(feature: ImageFeature): string {
	const operation = OPERATION_BY_FEATURE[feature];
	if (!operation) throw new UnsupportedImageFeatureError(feature);
	return operation;
}

export function imageCountForFeature(feature: ImageFeature): number {
	const count = IMAGE_COUNT_BY_FEATURE[feature];
	if (!count) throw new UnsupportedImageFeatureError(feature);
	return count;
}

export interface GenerateImagesInput {
	db: Db;
	images: ImageProvider;
	embeddings: EmbeddingProvider;
	storage: MediaStorage;
	similarity: SimilarityCacheDeps;
	universeId: string;
	aiEnabled: boolean;
	entity: {
		id: string;
		name: string;
		/** Already stripped of markdown/mention syntax by the caller - see prompt.ts. */
		description: string;
	};
	feature: ImageFeature;
	userId: string;
}

export interface GenerateImagesResult {
	assets: MediaAssetRow[];
	reusedFromCache: boolean;
	model: ResolvedModel;
	prompt: string;
}

export async function generateImages(input: GenerateImagesInput): Promise<GenerateImagesResult> {
	if (!input.aiEnabled) throw new AiDisabledError(input.universeId);

	const operation = operationForFeature(input.feature);
	const count = imageCountForFeature(input.feature);

	const [model, style] = await Promise.all([
		resolveImageModel(input.db, input.feature),
		resolveStyle(input.db, input.entity.id)
	]);

	const prompt = composePrompt({
		name: input.entity.name,
		description: input.entity.description,
		styleModifier: style.modifier
	});

	const vector = await input.embeddings.embed(prompt);

	const hit = await findSimilarMedia(input.similarity, {
		vector,
		universeId: input.universeId,
		feature: input.feature
	});
	if (hit) {
		const assets = await mediaAssetsByIds(input.db, hit.mediaAssetIds);
		// Every file behind a stale hit may since have been deleted - only trust it when
		// at least one row is still actually there, otherwise fall through and generate.
		if (assets.length > 0) {
			return { assets, reusedFromCache: true, model, prompt };
		}
	}

	const generated = await input.images.generate({
		prompt,
		model,
		count,
		userId: input.userId,
		universeId: input.universeId,
		operation
	});

	const price = await chargeFor(input.db, operation);
	const creditsPerImage = generated.length > 0 ? price.credits / generated.length : 0;
	const pointId = randomUUID();

	const assets: MediaAssetRow[] = [];
	for (const image of generated) {
		const file = await input.storage.save({
			universeId: input.universeId,
			kind: 'image',
			mimeType: image.mimeType,
			bytes: image.bytes
		});
		assets.push(
			await createMediaAsset(input.db, {
				universeId: input.universeId,
				entityId: null,
				kind: 'image',
				path: file.path,
				mimeType: image.mimeType,
				bytes: file.bytes,
				prompt,
				provider: model.provider,
				modelId: model.modelId,
				generated: true,
				similarityKey: pointId,
				credits: creditsPerImage
			})
		);
	}

	await recordMediaVector(input.similarity, {
		pointId,
		vector,
		universeId: input.universeId,
		feature: input.feature,
		mediaAssetIds: assets.map((asset) => asset.id)
	});

	return { assets, reusedFromCache: false, model, prompt };
}
