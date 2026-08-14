/**
 * Collection lifecycle (SPEC.md §11.3, issue #57). One collection per universe, named so
 * a model or provider switch never silently mixes vectors of two different dimensions
 * into the same collection - the model identity is part of the name, not just a payload
 * field.
 */
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ResolvedModel } from '@canonry/ai';

export type VectorDistance = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';

/** SPEC.md §11.3: "Per-universe Qdrant collections named
 * `UniverseLore_{provider}_{model}_{universeId}`". */
export function loreCollectionName(provider: string, modelId: string, universeId: string): string {
	return `UniverseLore_${provider}_${modelId}_${universeId}`;
}

/** Convenience over `loreCollectionName` for the common case of a resolved embedding
 * model from `@canonry/ai`'s `resolveModel(db, 'embedding')` - keeps the collection name
 * in lockstep with whatever `model_config` currently points at. */
export function loreCollectionNameForModel(model: ResolvedModel, universeId: string): string {
	return loreCollectionName(model.provider, model.modelId, universeId);
}

export interface EnsureCollectionOptions {
	name: string;
	vectorSize: number;
	/** SPEC.md §11.3: "cosine distance". Overridable for a non-lore collection (a sibling
	 * package's own similarity cache, for instance) that wants a different metric. */
	distance?: VectorDistance;
}

/**
 * Idempotent create: Qdrant has no "create if not exists", and issue #57's acceptance
 * ("collections are created and queried") means a second call - a re-run, a second
 * universe reusing the same model - must not fail on an existing collection.
 */
export async function ensureCollection(
	client: QdrantClient,
	options: EnsureCollectionOptions
): Promise<void> {
	const exists = await client.collectionExists(options.name);
	if (exists.exists) return;
	await client.createCollection(options.name, {
		vectors: { size: options.vectorSize, distance: options.distance ?? 'Cosine' }
	});
}

export async function collectionExists(client: QdrantClient, name: string): Promise<boolean> {
	const result = await client.collectionExists(name);
	return result.exists;
}

/** Test-only in practice (real collections are never dropped in production): the vector
 * package's own tests create a scratch collection and must clean it up (assignment's
 * "in a collection they create and drop"). */
export async function dropCollection(client: QdrantClient, name: string): Promise<void> {
	await client.deleteCollection(name);
}
