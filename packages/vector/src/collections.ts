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
	/**
	 * What to do when the collection already exists with a **different** vector size, which
	 * happens whenever the configured embedding model changes (issue #125 swapped a 256-dim
	 * bag-of-words hash for a 3072-dim multilingual model, and every collection written by the
	 * old one is now unreadable by the new one).
	 *
	 * There is deliberately no default. The right answer depends on what the collection holds,
	 * the caller is the only one who knows, and getting it wrong silently is the failure this
	 * option exists to prevent: Qdrant accepts the mismatched collection and then rejects every
	 * upsert with a shape error far from the cause.
	 *
	 * - `'throw'` for anything whose contents are the product of real work (indexed lore). A
	 *   dimension change there means someone has to re-index, and a re-index is a decision.
	 * - `'recreate'` for a cache, where the entries are re-derivable by definition and dropping
	 *   them costs one re-embed.
	 */
	onDimensionMismatch: 'throw' | 'recreate';
}

/** Thrown rather than swallowed: a collection whose vectors are a different width than the
 * current model produces cannot be queried or appended to, so continuing would mean writing
 * into something unreadable. Names both numbers, because the fix depends on which is which. */
export class VectorDimensionMismatchError extends Error {
	constructor(
		public readonly collection: string,
		public readonly existing: number,
		public readonly wanted: number
	) {
		super(
			`collection ${collection} holds ${existing}-dimension vectors but the configured model produces ${wanted}. ` +
				`Re-index this collection against the current model, or point model_config back at the model that wrote it.`
		);
		this.name = 'VectorDimensionMismatchError';
	}
}

async function existingVectorSize(client: QdrantClient, name: string): Promise<number | null> {
	const info = await client.getCollection(name);
	const vectors = info.config?.params?.vectors;
	// Narrowed rather than asserted: Qdrant's own type here is a union covering named and
	// unnamed vector configs, and the single-vector case is the only one this helper writes.
	if (vectors && typeof vectors === 'object' && 'size' in vectors) {
		const size: unknown = vectors.size;
		return typeof size === 'number' ? size : null;
	}
	return null;
}

/**
 * Idempotent create: Qdrant has no "create if not exists", and issue #57's acceptance
 * ("collections are created and queried") means a second call - a re-run, a second
 * universe reusing the same model - must not fail on an existing collection.
 *
 * An existing collection is also checked for width, per `onDimensionMismatch`.
 */
export async function ensureCollection(
	client: QdrantClient,
	options: EnsureCollectionOptions
): Promise<void> {
	const exists = await client.collectionExists(options.name);
	if (exists.exists) {
		const existing = await existingVectorSize(client, options.name);
		// A null size means an unnamed-vector or multi-vector config this helper never writes;
		// leave it alone rather than guessing which vector the caller meant.
		if (existing === null || existing === options.vectorSize) return;
		if (options.onDimensionMismatch === 'throw') {
			throw new VectorDimensionMismatchError(options.name, existing, options.vectorSize);
		}
		await client.deleteCollection(options.name);
	}
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
