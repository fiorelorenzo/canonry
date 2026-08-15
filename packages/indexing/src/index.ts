// Public surface of @canonry/indexing (SPEC.md §7, §11.3, §11.4, issues #58/#62).

export { TokenBucketRateLimiter, type RateLimiter } from './rate-limiter.js';

export {
	MediaWikiClient,
	MEDIAWIKI_DEFAULT_RATE_LIMIT,
	WikiRequestError,
	WikiPageNotFoundError,
	type WikiClient,
	type WikiPage,
	type MediaWikiClientConfig
} from './wiki-client.js';

export { wikitextToPlainText } from './wikitext.js';

export {
	chunkWikiPage,
	estimateTokens,
	DEFAULT_CHUNK_TOKEN_BUDGET,
	type WikiChunk,
	type ChunkWikiPageOptions
} from './chunking.js';

export { chunkPointId } from './point-id.js';

export type { ResolvedExtractionModel, ResolvedEmbeddingModel } from './models.js';
export { RECOMMENDED_EMBEDDING_MODEL } from './models.js';

export {
	createGatewayExtractor,
	heuristicExtractor,
	type ChunkExtractor,
	type ChunkMetadata,
	type ExtractionInput,
	type GatewayExtractorDeps
} from './extraction.js';

export {
	createGatewayEmbedder,
	hashingEmbedder,
	type Embedder,
	type GatewayEmbedderDeps
} from './embedding.js';

export {
	indexDataSource,
	type IndexDataSourceDeps,
	type IndexDataSourceOptions,
	type IndexDataSourceResult,
	type IndexPageOutcome
} from './pipeline.js';

export {
	retrieveForUniverse,
	scoreLoreHits,
	DEFAULT_TOP_K,
	DEFAULT_THRESHOLD,
	type RetrievalHit,
	type ScoreLoreHitsOptions,
	type RetrieveForUniverseOptions
} from './retriever.js';
