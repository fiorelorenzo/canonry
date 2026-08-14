/**
 * Qdrant connection (SPEC.md §7, §11.3, §12: "separate Qdrant instance" per environment).
 * Reads QDRANT_URL / QDRANT_API_KEY from the environment the same way .env.example wires
 * it for the app, defaulting to the loopback dev instance so a local run and a test need
 * no configuration at all.
 */
import { QdrantClient } from '@qdrant/js-client-rest';

export interface VectorClientConfig {
	url: string;
	apiKey?: string;
}

/** The dev-loopback default (docker/compose.yml maps the container's 6333 here). Deploys
 * always set QDRANT_URL explicitly (SPEC.md §12: preview and prod each get their own
 * instance), so this default only ever fires locally or in a test. */
const DEFAULT_QDRANT_URL = 'http://127.0.0.1:56333';

export function readVectorClientConfig(env: NodeJS.ProcessEnv = process.env): VectorClientConfig {
	const apiKey = env.QDRANT_API_KEY;
	return {
		url: env.QDRANT_URL ?? DEFAULT_QDRANT_URL,
		...(apiKey ? { apiKey } : {})
	};
}

export function createVectorClient(
	config: VectorClientConfig = readVectorClientConfig()
): QdrantClient {
	return new QdrantClient({
		url: config.url,
		...(config.apiKey ? { apiKey: config.apiKey } : {})
	});
}

export type { QdrantClient };
