/**
 * Collection lifecycle (SPEC.md §11.3, issue #57). One collection per universe, named so
 * a model or provider switch never silently mixes vectors of two different dimensions
 * into the same collection - the model identity is part of the name, not just a payload
 * field.
 */
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ResolvedModel } from '@canonry/ai';

export type VectorDistance = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';

/**
 * SPEC.md §11.3: "Per-universe Qdrant collections named
 * `UniverseLore_{provider}_{model}_{universeId}`".
 *
 * **`weightsOwner` is the identity of the weights, never the endpoint that served them.** For
 * `alibaba/qwen3-embedding-4b` that is `alibaba`, whoever we happen to route through: Vercel AI
 * Gateway resolves it to DeepInfra today, and Fireworks, Together, Cloudflare, DashScope or our own
 * hardware would all return vectors from the same Apache-2.0 weights, interchangeable for cosine
 * search (measured: repeated calls agree to a self-similarity of 0.99989).
 *
 * That distinction is the whole portability argument. Naming a collection after the endpoint would
 * force a full re-index every time we changed where the same model runs, which is exactly the cost
 * open weights were chosen to avoid. `model_config.provider` holds the weights owner for this
 * reason, and a future self-hosting path must keep it that way rather than writing 'local' there.
 */
export function loreCollectionName(
	weightsOwner: string,
	modelId: string,
	universeId: string
): string {
	return `UniverseLore_${weightsOwner}_${modelId}_${universeId}`;
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
 *
 * **Idempotent across concurrent callers too, since issue #709, and that is not a nicety.**
 * The exists-then-create pair is not atomic, so two callers that both find the collection
 * absent both try to create it and Qdrant answers the loser `409 Conflict`. It was rare
 * before: it takes two writes to a universe that has never been indexed, inside one debounce
 * window. #709's backfill makes it the normal case rather than a rarity, because a catch-up's
 * whole premise is a collection that does not exist yet and N entries fanned out at once - and
 * it was measured rather than reasoned about: the first end-to-end run of that backfill lost
 * two of six entries to `{"status":"error","message":"Conflict"}`, which is an entry left out
 * of retrieval by the very thing that exists to put it back.
 *
 * The loser re-reads instead of failing. A `409` here means somebody else created it in the
 * gap, so the honest response is to check the width of what they made, which is exactly what
 * the caller would have done had it arrived a moment later. Any other failure is rethrown.
 */
export async function ensureCollection(
	client: QdrantClient,
	options: EnsureCollectionOptions
): Promise<void> {
	const exists = await client.collectionExists(options.name);
	if (exists.exists) return checkExistingWidth(client, options);
	try {
		await client.createCollection(options.name, {
			vectors: { size: options.vectorSize, distance: options.distance ?? 'Cosine' }
		});
	} catch (err) {
		if (!(await collectionExists(client, options.name))) throw err;
		// Lost a create race. Whatever the winner made is what this caller has to work with, so
		// it goes through the same width check an existing collection always gets.
		await checkExistingWidth(client, options);
	}
}

/** The `onDimensionMismatch` branch, shared by "it was already there" and "somebody else
 * created it while I was asking". Recreating on a mismatch is itself racy in principle, and
 * deliberately not defended here: `'recreate'` is only ever passed for a cache whose entries
 * are re-derivable, and the lore path passes `'throw'`. */
async function checkExistingWidth(
	client: QdrantClient,
	options: EnsureCollectionOptions
): Promise<void> {
	const existing = await existingVectorSize(client, options.name);
	// A null size means an unnamed-vector or multi-vector config this helper never writes;
	// leave it alone rather than guessing which vector the caller meant.
	if (existing === null || existing === options.vectorSize) return;
	if (options.onDimensionMismatch === 'throw') {
		throw new VectorDimensionMismatchError(options.name, existing, options.vectorSize);
	}
	await client.deleteCollection(options.name);
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
