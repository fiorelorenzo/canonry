/**
 * End-to-end portrait/variant generation (#64-#67, #70, #71) plus regeneration with an
 * extra instruction (#255). Resolves the active model for the feature, builds the prompt
 * from the entry plus its resolved style (or, for a regeneration, from the prior
 * attempt's own stored prompt plus what the user said was wrong with it), checks the
 * similarity cache before spending anything, and otherwise generates through the
 * concurrency-limited provider, stores the files, and inserts unattached media_asset rows
 * for the GM to pick from.
 *
 * Guardrail 6 / #382: this function never sets `gm_only`. createMediaAsset's own schema
 * default (false) is the only thing that ever decides that column's value - there is no
 * parameter here for a caller to pass true, on a cache hit or otherwise. A generated
 * image is unattached until the GM picks it (`entity_id` null), which is what keeps it
 * from players regardless of the default.
 *
 * #255 and untrusted input: `instruction` is a string a universe member typed, and it
 * ends up inside the prompt sent to the image model. This is not a tool-calling loop -
 * unlike the import playbooks' SPEC.md §6.5 problem, there is no agent here reading the
 * instruction and deciding what to do next, so there is no "ignore your instructions and
 * ..." to fall for. But the same discipline applies for the same reason: the instruction
 * is treated purely as data appended to a string, never as something our own code parses
 * or branches on. It cannot choose the operation charged, the feature, the universe, or
 * whether the result publishes - every one of those still comes from a typed field this
 * function itself controls. The only thing it can ever do is lengthen the tail of
 * `prompt`, and composeRegeneratePrompt (prompt.ts) truncates even that.
 */
import { randomUUID } from 'node:crypto';
import { chargeFor, type ResolvedModel } from '@canonry/ai';
import {
	createMediaAsset,
	mediaAssetById,
	mediaAssetsByIds,
	type Db,
	type MediaAssetRow
} from '@canonry/db';
import type { ImageFeature } from '@canonry/db/schema';
import { composePrompt, composeRegeneratePrompt } from './prompt.js';
import { resolveStyle } from './style.js';
import { imageModelFromRow, readImageModelParams, resolveImageModelRow } from './models.js';
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

/** A feature with no priced operation and no image count of its own. Nothing reaches this
 * today: `portrait`, `variants` and `scene` (#258) are the whole `image_feature` enum and
 * all three are configured below. It stays because the enum is a database type and a
 * fourth value can be added by a migration without this file noticing, and throwing here
 * is the honest answer to that rather than charging a made-up operation. */
export class UnsupportedImageFeatureError extends Error {
	constructor(feature: ImageFeature) {
		super(`image feature "${feature}" has no priced operation configured yet`);
		this.name = 'UnsupportedImageFeatureError';
	}
}

/** #255: `fromAssetId` names a row that either does not exist or belongs to a different
 * universe than the one this request is scoped to. Same message either way - which of
 * the two it is is not this caller's business, exactly like `RelationTypeNotOwnedError`
 * (packages/db/src/queries/relation-types.ts) never distinguishes "missing" from "not
 * yours" for a cross-universe id. */
export class MediaAssetNotOwnedError extends Error {
	constructor(assetId: string, universeId: string) {
		super(`media_asset "${assetId}" is not owned by universe "${universeId}"`);
		this.name = 'MediaAssetNotOwnedError';
	}
}

/** #255: `fromAssetId` resolved to a real row in the right universe, but that row has no
 * stored prompt to build on - true of an imported or uploaded image (#252, #253), which
 * carry no `prompt` because nothing generated them. There is nothing to append the
 * instruction to, so this refuses rather than silently falling back to a fresh
 * entity/style prompt that would ignore `fromAssetId` entirely. */
export class MediaAssetHasNoPromptError extends Error {
	constructor(assetId: string) {
		super(`media_asset "${assetId}" has no stored prompt to regenerate from`);
		this.name = 'MediaAssetHasNoPromptError';
	}
}

const OPERATION_BY_FEATURE: Partial<Record<ImageFeature, string>> = {
	portrait: 'image.portrait',
	variants: 'image.variants',
	scene: 'image.scene'
};

const IMAGE_COUNT_BY_FEATURE: Partial<Record<ImageFeature, number>> = {
	portrait: 1,
	variants: 4,
	scene: 1
};

/**
 * The shape of the image is not decided here (#332). It lives on the `image_model_config`
 * row, in `params.aspectRatio`, next to the model that has to honour it: a table in this
 * file could not survive an /admin/models model swap, and a swap that silently drops the
 * shape is exactly the defect #332 describes. models.ts reads the key, aspect-ratio.ts
 * holds each model's own enum, and migration 0045 seeds all three rows.
 *
 * Round twelve's Q5 (#366) adds the one thing a per-feature row cannot express: a cover's
 * shape depends on the entity type, portrait for a character and wide for a place, so the
 * caller may pass `aspectRatio` for a single request and the row is what a caller with no
 * type to speak for gets. The row is still where /admin/models validates and still what a
 * model swap has to satisfy, and the provider still refuses a value the configured model's
 * enum does not list, whichever of the two it came from.
 */

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
	/** #255: the user's stated fix for the picture named by `fromAssetId` ("older, and
	 * lose the helmet"). Untrusted user text - see this file's header comment. Blank or
	 * whitespace-only is treated the same as omitted. */
	instruction?: string;
	/** #255: the media_asset id of the attempt being refined. Must belong to
	 * `universeId` or this throws MediaAssetNotOwnedError. When set, its own stored
	 * `prompt` replaces the entity+style compose as the base prompt, so round two builds
	 * on the picture the user actually saw rather than rolling the entity text again. */
	fromAssetId?: string;
	/**
	 * Round twelve Q5 (#366): the shape this one request wants, overriding the row's
	 * `params.aspectRatio`. It exists because a cover's shape varies by entity type - a
	 * character is drawn portrait and a place wide - and a per-feature row cannot hold a
	 * per-type answer.
	 *
	 * #332's guarantee is unchanged and is why this is a value passed in rather than a
	 * fallback chain: the provider checks whatever it is finally given against the
	 * configured model's own enum and throws `ImageAspectRatioUnsupportedError` rather
	 * than letting Replicate quietly draw at its default. The row keeps the default for
	 * every caller that has no entity type to speak for (the bench, and any feature whose
	 * shape is a property of the feature rather than of its subject, which is what `scene`
	 * is).
	 */
	aspectRatio?: string;
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
	const instruction = input.instruction?.trim() || undefined;

	const [modelRow, style, priorAsset] = await Promise.all([
		resolveImageModelRow(input.db, input.feature),
		resolveStyle(input.db, input.entity.id),
		input.fromAssetId ? mediaAssetById(input.db, input.fromAssetId) : Promise.resolve(undefined)
	]);
	const model = imageModelFromRow(modelRow);
	const modelParams = readImageModelParams(modelRow.params);
	// #366: the request's own shape wins over the row's, and the row is the default for a
	// caller that has none. Resolved once here so the three places that need it - the cache
	// lookup, the provider call and the recorded point - cannot disagree about what shape
	// this generation is.
	const aspectRatio = input.aspectRatio ?? modelParams.aspectRatio;

	if (input.fromAssetId) {
		if (!priorAsset || priorAsset.universeId !== input.universeId) {
			throw new MediaAssetNotOwnedError(input.fromAssetId, input.universeId);
		}
		if (!priorAsset.prompt) throw new MediaAssetHasNoPromptError(input.fromAssetId);
	}

	const basePrompt = priorAsset?.prompt
		? priorAsset.prompt
		: composePrompt({
				name: input.entity.name,
				description: input.entity.description,
				styleModifier: style.modifier,
				feature: input.feature
			});
	const prompt = instruction
		? composeRegeneratePrompt({ priorPrompt: basePrompt, instruction })
		: basePrompt;

	const vector = await input.embeddings.embed(prompt);

	// #255: an instruction is the user deliberately asking for something different from
	// the attempt they are looking at. Serving a cache hit here would silently hand back
	// exactly the picture they are trying to move away from, which is worse than a
	// pointless generation - it looks like the request was ignored. So the lookup itself
	// is skipped (not just its result discarded) whenever there is an instruction to
	// honour; a plain repeat request with no instruction still hits the cache exactly as
	// before (#67).
	if (!instruction) {
		const hit = await findSimilarMedia(input.similarity, {
			vector,
			universeId: input.universeId,
			feature: input.feature,
			...(aspectRatio ? { aspectRatio } : {})
		});
		if (hit) {
			const assets = await mediaAssetsByIds(input.db, hit.mediaAssetIds);
			// Every file behind a stale hit may since have been deleted - only trust it when
			// at least one row is still actually there, otherwise fall through and generate.
			if (assets.length > 0) {
				return { assets, reusedFromCache: true, model, prompt };
			}
		}
	}

	const generated = await input.images.generate({
		prompt,
		model,
		count,
		userId: input.userId,
		universeId: input.universeId,
		operation,
		...(aspectRatio ? { aspectRatio } : {})
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
		...(aspectRatio ? { aspectRatio } : {}),
		mediaAssetIds: assets.map((asset) => asset.id)
	});

	return { assets, reusedFromCache: false, model, prompt };
}
