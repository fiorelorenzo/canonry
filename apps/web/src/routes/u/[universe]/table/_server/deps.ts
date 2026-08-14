/**
 * Process-lifetime singletons and env-derived credentials for the table subtree's server
 * routes, same reasoning as `$lib/server/db.ts` and `$lib/server/media.ts`: a route reads
 * these instead of constructing its own gateway wrapper or Qdrant client per request.
 */
import { env } from '$env/dynamic/private';
import { readGatewayCredentials, type GatewayCredentials } from '@canonry/ai';
import { readEmbeddingApiToken } from '@canonry/media';
import { createVectorClient, readVectorClientConfig, type QdrantClient } from '@canonry/vector';

export function tableGatewayCredentials(): GatewayCredentials {
	return readGatewayCredentials(env);
}

export function tableEmbeddingApiToken(): string {
	return readEmbeddingApiToken(env);
}

let qdrant: QdrantClient | undefined;

export function tableVectorClient(): QdrantClient {
	if (!qdrant) qdrant = createVectorClient(readVectorClientConfig(env));
	return qdrant;
}
