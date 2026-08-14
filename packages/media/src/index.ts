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

export { composePrompt, type ComposePromptInput } from './prompt.js';

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
	readEmbeddingApiToken,
	MissingEmbeddingApiTokenError,
	EmbeddingRequestError,
	type EmbeddingProvider,
	type GatewayEmbeddingProviderDeps
} from './embedding.js';

export {
	findSimilarMedia,
	recordMediaVector,
	createVectorClient,
	SIMILARITY_THRESHOLD,
	MEDIA_SIMILARITY_COLLECTION,
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
	type GenerateImagesInput,
	type GenerateImagesResult
} from './generate.js';
