// Public surface of the ambient audio subsystem (#68, #69, SPEC.md §8.2). Everything a
// caller (the table/audio routes, a future warm trigger) needs to decompose a
// description into layers, check the SFX cache, generate through the concurrency-limited
// provider and suppress a same-scene resubmission - nothing else is exported.

export {
	generateAmbientPack,
	AMBIENT_LAYER_OPERATION,
	AMBIENT_SAME_SCENE_THRESHOLD,
	type ActiveAmbientPack,
	type AmbientLayerResult,
	type GenerateAmbientPackInput,
	type GenerateAmbientPackResult
} from './generate.js';

export {
	parseAmbientLayers,
	AMBIENT_LAYERS_OPERATION,
	type LanguageModelFactory,
	type ParsedAmbientLayer,
	type ParseAmbientLayersInput
} from './layers.js';

export {
	ElevenLabsAudioProvider,
	FakeAudioProvider,
	ELEVENLABS_PROVIDER,
	ELEVENLABS_MODEL_ID,
	MissingElevenLabsEnvError,
	ElevenLabsRequestError,
	ElevenLabsQuotaExceededError,
	ElevenLabsThrottledError,
	ElevenLabsMissingCostHeaderError,
	readElevenLabsApiToken,
	tinyWavBytes,
	type AudioProvider,
	type AudioGenerateInput,
	type GeneratedAudio,
	type ElevenLabsAudioProviderDeps
} from './provider.js';

export {
	findSimilarAudioLayer,
	recordAudioLayerVector,
	audioLayerSimilarityCollectionName,
	SIMILARITY_THRESHOLD as AUDIO_SIMILARITY_THRESHOLD,
	type AudioSimilarityCacheDeps,
	type AudioSimilarityHit,
	type FindSimilarAudioLayerInput,
	type RecordAudioLayerVectorInput,
	type QdrantClient
} from './cache.js';

export { contentJaccard } from './scene-similarity.js';
