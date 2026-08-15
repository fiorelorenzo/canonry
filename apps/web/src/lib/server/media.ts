/**
 * Shared server-side singletons for the entry media UI and /admin/models (#64-#67, #70,
 * #71). One process-lifetime instance each, same reasoning as $lib/server/db.ts: a route
 * loader or action imports these rather than constructing its own provider, storage or
 * concurrency limiter per request.
 *
 * The image provider is always the real Replicate one - never a fake wired in behind an
 * env switch. A generate request throws MissingReplicateEnvError until
 * REPLICATE_API_TOKEN is configured for this process; that is the honest behaviour, not a
 * silent fallback that would persist a fabricated image as though it were real.
 */
import { embeddingDimensionsFor } from '@canonry/indexing';
import { env } from '$env/dynamic/private';
import {
	readGatewayCredentials,
	readReplicateApiToken,
	resolveModel,
	type GatewayCredentials
} from '@canonry/ai';
import {
	FilesystemMediaStorage,
	GatewayEmbeddingProvider,
	ProviderLimiter,
	ReplicateImageProvider,
	createVectorClient,
	readMediaRoot,
	type EmbeddingProvider,
	type ImageProvider,
	type MediaStorage,
	type QdrantClient,
	type SimilarityCacheDeps,
	mediaSimilarityCollectionName
} from '@canonry/media';
import { db } from './db';

let storage: MediaStorage | undefined;

export function mediaStorage(): MediaStorage {
	if (!storage) storage = new FilesystemMediaStorage(readMediaRoot(env));
	return storage;
}

let limiter: ProviderLimiter | undefined;

function providerLimiter(): ProviderLimiter {
	if (!limiter) limiter = new ProviderLimiter();
	return limiter;
}

function gatewayCredentials(): GatewayCredentials {
	return readGatewayCredentials(env);
}

export function imageProvider(): ImageProvider {
	return new ReplicateImageProvider({
		db: db(),
		replicateApiToken: readReplicateApiToken(env),
		limiter: providerLimiter(),
		agent: 'media'
	});
}

/** GatewayEmbeddingProviderDeps carries userId/universeId because @canonry/ai's withUsage
 * needs them for cost attribution even at 0 credits - a fresh instance per request (built
 * here, not memoised like the other singletons) is the only way those two fields are
 * ever the actual request's, not stale from whichever request built a shared instance. */
export function embeddingProviderFor(userId: string, universeId: string | null): EmbeddingProvider {
	return new GatewayEmbeddingProvider({
		db: db(),
		credentials: gatewayCredentials(),
		userId,
		universeId,
		agent: 'media',
		operation: 'media.similarity_check'
	});
}

let vectorClient: QdrantClient | undefined;

/**
 * SPEC.md §9's 0.94 threshold is a fixed constant on @canonry/media's side; the vector width has
 * to be whatever the configured `'embedding'` model actually produces, which is why it is
 * resolved from `model_config` rather than read from an env var. `EMBEDDING_VECTOR_SIZE` used to
 * default to 1536 here and the live collections were written at 256 by the test fake, so the
 * first real 3072-dimension vector would have been rejected by a collection nobody had noticed
 * was the wrong shape. A number derived from the model cannot drift from the model.
 */
export async function similarityDeps(): Promise<SimilarityCacheDeps> {
	if (!vectorClient) vectorClient = createVectorClient();
	const model = await resolveModel(db(), 'embedding');
	return {
		client: vectorClient,
		vectorSize: embeddingDimensionsFor(model.provider, model.modelId),
		collection: mediaSimilarityCollectionName(model.provider, model.modelId)
	};
}
