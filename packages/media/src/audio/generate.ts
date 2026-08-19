/**
 * End-to-end ambient pack generation (#68). Decomposes a description into layers
 * (layers.ts), suppresses a same-scene resubmission (scene-similarity.ts), checks the
 * SFX cache before spending anything per layer (cache.ts), and otherwise generates
 * through the concurrency-limited, quota-charged provider (provider.ts), stores the
 * files and inserts unattached media_asset rows - the same shape as ../generate.ts's
 * generateImages, reusing its AiDisabledError since guardrail 4 is one switch, not a
 * separate one per media kind.
 *
 * Deliberately DB-free about "what is currently playing here": this module takes the
 * active pack (if any) as a plain input rather than reading warm_artifact or
 * session_context itself, so it stays a pure generation engine any caller can drive - an
 * on-demand table-mode request (apps/web's table/audio route) today, a warm trigger's
 * WarmGenerator later. The caller owns persistence.
 */
import { randomUUID } from 'node:crypto';
import { createMediaAsset, mediaAssetById, type Db, type MediaAssetRow } from '@canonry/db';
import { AiDisabledError } from '../generate.js';
import type { EmbeddingProvider } from '../embedding.js';
import type { MediaStorage } from '../storage.js';
import {
	findSimilarAudioLayer,
	recordAudioLayerVector,
	type AudioSimilarityCacheDeps
} from './cache.js';
import {
	parseAmbientLayers,
	type LanguageModelFactory,
	type ParsedAmbientLayer
} from './layers.js';
import { ELEVENLABS_MODEL_ID, ELEVENLABS_PROVIDER, type AudioProvider } from './provider.js';
import { chargeFor } from '@canonry/ai';
import { AMBIENT_SAME_SCENE_THRESHOLD, contentJaccard } from './scene-similarity.js';

export { AMBIENT_SAME_SCENE_THRESHOLD };

export const AMBIENT_LAYER_OPERATION = 'audio.layer';

export interface AmbientLayerResult {
	mediaAssetId: string;
	prompt: string;
	loopType: 'continuous' | 'oneshot' | 'interval';
	intervalMinSeconds?: number;
	intervalMaxSeconds?: number;
	volume: number;
	mimeType: string;
	/** False for a layer served from the SFX cache or carried over unchanged from the
	 * active pack on a same-scene suppression - true only for a layer that actually
	 * called the provider this request. */
	generated: boolean;
	/** 3 for a freshly generated layer (operation_price's 'audio.layer'), 0 for a cache
	 * hit or a carried-over layer - nothing was spent producing this row this call. */
	credits: number;
}

export interface ActiveAmbientPack {
	description: string;
	layers: AmbientLayerResult[];
}

export interface GenerateAmbientPackInput {
	db: Db;
	audio: AudioProvider;
	embeddings: EmbeddingProvider;
	storage: MediaStorage;
	similarity: AudioSimilarityCacheDeps;
	languageModel: LanguageModelFactory;
	universeId: string;
	aiEnabled: boolean;
	userId: string;
	description: string;
	/** The pack currently active for this place/scene, if any - what the same-scene
	 * Jaccard suppression compares the new description against, and what is returned
	 * unchanged when it fires. Null always regenerates. */
	activePack: ActiveAmbientPack | null;
}

export interface GenerateAmbientPackResult {
	/** True when the Jaccard suppression fired (SPEC.md §8.2, 0.30 threshold): the
	 * request was judged the same scene as activePack and nothing was generated. */
	suppressed: boolean;
	description: string;
	layers: AmbientLayerResult[];
	/** Sum of every layer's credits this call actually spent - 0 whenever suppressed is
	 * true or every layer was served from cache. */
	totalCredits: number;
}

/** One layer: cache lookup, then generate-and-store on a miss. Never throws on a stale
 * cache pointer (a media_asset row deleted since it was cached) - falls through to
 * generating fresh, mirroring ../generate.ts's own "at least one row is still actually
 * there" check for images. */
async function resolveLayer(
	input: GenerateAmbientPackInput,
	layer: ParsedAmbientLayer
): Promise<{ result: AmbientLayerResult; credits: number }> {
	const loop = layer.loopType === 'continuous';
	const vector = await input.embeddings.embed(layer.prompt);

	const hit = await findSimilarAudioLayer(input.similarity, {
		vector,
		universeId: input.universeId,
		loop
	});
	if (hit) {
		const cached = await mediaAssetById(input.db, hit.mediaAssetId);
		if (cached) {
			return {
				credits: 0,
				result: layerResultFrom(layer, cached, { generated: false, credits: 0 })
			};
		}
	}

	const generatedAudio = await input.audio.generate({
		prompt: layer.prompt,
		loop,
		userId: input.userId,
		universeId: input.universeId,
		operation: AMBIENT_LAYER_OPERATION
	});

	const file = await input.storage.save({
		universeId: input.universeId,
		kind: 'audio',
		mimeType: generatedAudio.mimeType,
		bytes: generatedAudio.bytes
	});

	// Resolved after generation succeeds, same ordering ../generate.ts uses for images:
	// chargeFor is a cached read (never a spend by itself - the real spend already
	// happened inside the provider's own withQuota-equivalent), used here only to stamp
	// the display credits this layer's row carries.
	const price = await chargeFor(input.db, AMBIENT_LAYER_OPERATION);
	const pointId = randomUUID();

	const asset = await createMediaAsset(input.db, {
		universeId: input.universeId,
		entityId: null,
		kind: 'audio',
		path: file.path,
		mimeType: generatedAudio.mimeType,
		bytes: file.bytes,
		prompt: layer.prompt,
		provider: ELEVENLABS_PROVIDER,
		modelId: ELEVENLABS_MODEL_ID,
		generated: true,
		similarityKey: pointId,
		credits: price.credits
	});

	await recordAudioLayerVector(input.similarity, {
		pointId,
		vector,
		universeId: input.universeId,
		loop,
		mediaAssetId: asset.id
	});

	return {
		credits: price.credits,
		result: layerResultFrom(layer, asset, { generated: true, credits: price.credits })
	};
}

function layerResultFrom(
	layer: ParsedAmbientLayer,
	asset: MediaAssetRow,
	flags: { generated: boolean; credits: number }
): AmbientLayerResult {
	const result: AmbientLayerResult = {
		mediaAssetId: asset.id,
		prompt: layer.prompt,
		loopType: layer.loopType,
		volume: layer.volume,
		mimeType: asset.mimeType,
		generated: flags.generated,
		credits: flags.credits
	};
	// `ParsedAmbientLayer`'s interval fields are `number | null` (issue #293: required +
	// nullable in the model-facing schema, so the key is always present for OpenAI's
	// structured-output mode). `AmbientLayerResult` keeps the field itself optional and
	// omits the key entirely for a non-interval layer, same compact shape as before.
	if (layer.intervalMinSeconds !== null) result.intervalMinSeconds = layer.intervalMinSeconds;
	if (layer.intervalMaxSeconds !== null) result.intervalMaxSeconds = layer.intervalMaxSeconds;
	return result;
}

export async function generateAmbientPack(
	input: GenerateAmbientPackInput
): Promise<GenerateAmbientPackResult> {
	if (!input.aiEnabled) throw new AiDisabledError(input.universeId);

	if (
		input.activePack &&
		contentJaccard(input.activePack.description, input.description) >= AMBIENT_SAME_SCENE_THRESHOLD
	) {
		return {
			suppressed: true,
			description: input.activePack.description,
			layers: input.activePack.layers,
			totalCredits: 0
		};
	}

	const parsedLayers = await parseAmbientLayers({
		db: input.db,
		languageModel: input.languageModel,
		description: input.description,
		userId: input.userId,
		universeId: input.universeId
	});

	const layers: AmbientLayerResult[] = [];
	let totalCredits = 0;
	for (const layer of parsedLayers) {
		const { result, credits } = await resolveLayer(input, layer);
		layers.push(result);
		totalCredits += credits;
	}

	return { suppressed: false, description: input.description, layers, totalCredits };
}
