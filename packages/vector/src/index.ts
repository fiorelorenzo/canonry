// Public surface of @canonry/vector (SPEC.md §11.3, issues #57/#62). The Qdrant
// abstraction: connection, collection lifecycle, generic point storage, and the
// lore-specific payload/query layer with its mandatory universe_id filter.

export { createVectorClient, readVectorClientConfig, type VectorClientConfig } from './client.js';
export type { QdrantClient } from './client.js';

export {
	loreCollectionName,
	loreCollectionNameForModel,
	ensureCollection,
	collectionExists,
	dropCollection,
	type VectorDistance,
	type EnsureCollectionOptions
} from './collections.js';

export {
	upsertPoints,
	queryPoints,
	deletePoints,
	scrollPoints,
	countPoints,
	type VectorPoint,
	type VectorFilter,
	type VectorFilterCondition,
	type VectorQuery,
	type VectorHit,
	type VectorRecord
} from './points.js';

export {
	upsertLoreChunks,
	queryLore,
	deleteLorePage,
	findPageUpdatedAt,
	urlMatchesPattern,
	type LoreChunk,
	type LoreChunkPayload,
	type LoreQuery,
	type LoreHit
} from './lore.js';
