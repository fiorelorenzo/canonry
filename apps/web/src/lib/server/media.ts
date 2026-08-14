/**
 * Shared server-side singletons for the entry media UI and /admin/models (#64-#67, #70,
 * #71). One process-lifetime instance each, same reasoning as $lib/server/db.ts: a route
 * loader or action imports these rather than constructing its own provider, storage or
 * concurrency limiter per request.
 *
 * The image provider is always the real Replicate one - never a fake wired in behind an
 * env switch. This box has no REPLICATE_API_TOKEN, so a generate request here throws
 * MissingReplicateEnvError until one is configured; that is the honest behaviour, not a
 * silent fallback that would persist a fabricated image as though it were real.
 */
import { env } from '$env/dynamic/private';
import {
	readGatewayCredentials,
	readReplicateApiToken,
	type GatewayCredentials
} from '@canonry/ai';
import {
	FilesystemMediaStorage,
	GatewayEmbeddingProvider,
	ProviderLimiter,
	ReplicateImageProvider,
	createVectorClient,
	readEmbeddingApiToken,
	readMediaRoot,
	type EmbeddingProvider,
	type ImageProvider,
	type MediaStorage,
	type QdrantClient,
	type SimilarityCacheDeps
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
		credentials: gatewayCredentials(),
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
		apiToken: readEmbeddingApiToken(env),
		userId,
		universeId,
		agent: 'media',
		operation: 'media.similarity_check'
	});
}

let vectorClient: QdrantClient | undefined;

/** SPEC.md §9's 0.94 threshold is a fixed constant on @canonry/media's side; the vector
 * size here must match whatever the 'embedding' purpose model actually produces (unknown
 * until one is configured - 1536 is OpenAI's text-embedding-3-small, the common default,
 * overridable via EMBEDDING_VECTOR_SIZE for a different provider). */
export function similarityDeps(): SimilarityCacheDeps {
	if (!vectorClient) vectorClient = createVectorClient();
	const vectorSize = Number.parseInt(env.EMBEDDING_VECTOR_SIZE ?? '1536', 10);
	return { client: vectorClient, vectorSize };
}
