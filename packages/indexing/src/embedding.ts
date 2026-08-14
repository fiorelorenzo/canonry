/**
 * Batch embedding (SPEC.md §7/§11.3: "batch embedding, upsert into a per-universe Qdrant
 * collection"). Injected as an `Embedder`, the same seam idiom `extraction.ts` uses for
 * the LLM metadata pass.
 */
import { embedMany } from 'ai';
import type { Db } from '@canonry/db';
import { withUsage } from '@canonry/ai';
import type { ResolvedEmbeddingModel } from './models.js';

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface GatewayEmbedderDeps {
	db: Db;
	model: ResolvedEmbeddingModel;
	userId: string;
	universeId: string | null;
}

/** Production implementation: one `embedMany` call per batch, wrapped in `withUsage`
 * (agent `'indexing'`, operation `'index.wiki.embed'`, zero credits - see
 * `operation_price`). */
export function createGatewayEmbedder(deps: GatewayEmbedderDeps): Embedder {
	return async (texts) => {
		if (texts.length === 0) return [];
		const result = await withUsage(
			deps.db,
			deps.model,
			{
				userId: deps.userId,
				universeId: deps.universeId,
				agent: 'indexing',
				operation: 'index.wiki.embed'
			},
			() => embedMany({ model: deps.model.model, values: texts }),
			{ extractUsage: (result) => ({ embeddingTokens: result.usage.tokens ?? 0 }) }
		);
		return result.embeddings;
	};
}

const HASH_VECTOR_SIZE = 256;

function hashToken(token: string, dimensions: number): number {
	let hash = 2166136261; // FNV-1a offset basis
	for (let i = 0; i < token.length; i++) {
		hash ^= token.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return Math.abs(hash) % dimensions;
}

/**
 * A network-free, deterministic default embedder using the hashing trick (a real,
 * classical bag-of-words vectorisation, not a placeholder): each token hashes into one of
 * `HASH_VECTOR_SIZE` buckets, the vector is the resulting term-frequency histogram,
 * L2-normalised so cosine similarity is meaningful. No network dependency, so this is
 * what this package's own tests and the retrieval harness wiring use where a real
 * semantic embedding model is not available; `createGatewayEmbedder` above is what a real
 * indexing run wires in instead - swapping the two changes nothing else in the pipeline,
 * since both satisfy the same `Embedder` seam.
 */
export const hashingEmbedder: Embedder = async (texts) => {
	return texts.map((text) => {
		const vector = new Array(HASH_VECTOR_SIZE).fill(0) as number[];
		const tokens = text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter((token) => token.length > 0);
		for (const token of tokens) {
			const bucket = hashToken(token, HASH_VECTOR_SIZE);
			vector[bucket] = (vector[bucket] ?? 0) + 1;
		}
		const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
		return norm > 0 ? vector.map((v) => v / norm) : vector;
	});
};
