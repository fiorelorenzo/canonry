// Public surface of @canonry/media (#64-#67, #70, #71). Everything a caller (the /media
// routes, /admin/models) needs to resolve the active model, build a prompt, check the
// similarity cache and generate images through a concurrency-limited provider - nothing
// else is exported.

export {
	Semaphore,
	ProviderLimiter,
	DEFAULT_PROVIDER_CONCURRENCY,
	readProviderConcurrencyConfig,
	type ProviderConcurrencyConfig,
	type ProviderName
} from './concurrency.js';

export {
	resolveImageModel,
	resolveImageModelRow,
	clearImageModelCache,
	ImageModelNotConfiguredError,
	type ImageModelRow,
	type ImageModelParams
} from './models.js';

export {
	composePrompt,
	composeRegeneratePrompt,
	type ComposePromptInput,
	type ComposeRegeneratePromptInput
} from './prompt.js';

export {
	resolveStyle,
	pickStyle,
	EntryNotFoundError,
	type ResolvedStyle,
	type StyleSource,
	type EntryStyleContext
} from './style.js';

export {
	ReplicateImageProvider,
	FakeImageProvider,
	predictionImageUrls,
	tinyPngBytes,
	type ImageProvider,
	type ImageGenerateInput,
	type GeneratedImage,
	type ReplicateImageProviderDeps
} from './provider.js';

export {
	FakeEmbeddingProvider,
	GatewayEmbeddingProvider,
	trigramEmbedding,
	type EmbeddingProvider,
	type GatewayEmbeddingProviderDeps
} from './embedding.js';

export {
	findSimilarMedia,
	recordMediaVector,
	createVectorClient,
	SIMILARITY_THRESHOLD,
	mediaSimilarityCollectionName,
	type SimilarityCacheDeps,
	type SimilarityHit,
	type FindSimilarInput,
	type RecordVectorInput,
	type QdrantClient
} from './similarity.js';

export {
	FilesystemMediaStorage,
	readMediaRoot,
	PathEscapeError,
	type MediaStorage,
	type StoredFile,
	type SaveMediaInput
} from './storage.js';

export {
	generateImages,
	operationForFeature,
	imageCountForFeature,
	AiDisabledError,
	UnsupportedImageFeatureError,
	MediaAssetNotOwnedError,
	MediaAssetHasNoPromptError,
	type GenerateImagesInput,
	type GenerateImagesResult
} from './generate.js';

export {
	generateAmbientPack,
	AMBIENT_LAYER_OPERATION,
	AMBIENT_SAME_SCENE_THRESHOLD,
	parseAmbientLayers,
	AMBIENT_LAYERS_OPERATION,
	ElevenLabsAudioProvider,
	FakeAudioProvider,
	ELEVENLABS_PROVIDER,
	ELEVENLABS_MODEL_ID,
	MissingElevenLabsEnvError,
	ElevenLabsRequestError,
	ElevenLabsQuotaExceededError,
	ElevenLabsMissingCostHeaderError,
	readElevenLabsApiToken,
	tinyWavBytes,
	findSimilarAudioLayer,
	recordAudioLayerVector,
	audioLayerSimilarityCollectionName,
	AUDIO_SIMILARITY_THRESHOLD,
	contentJaccard,
	type ActiveAmbientPack,
	type AmbientLayerResult,
	type GenerateAmbientPackInput,
	type GenerateAmbientPackResult,
	type LanguageModelFactory,
	type ParsedAmbientLayer,
	type ParseAmbientLayersInput,
	type AudioProvider,
	type AudioGenerateInput,
	type GeneratedAudio,
	type ElevenLabsAudioProviderDeps,
	type AudioSimilarityCacheDeps,
	type AudioSimilarityHit,
	type FindSimilarAudioLayerInput,
	type RecordAudioLayerVectorInput
} from './audio/index.js';
