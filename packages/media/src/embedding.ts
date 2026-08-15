/**
 * Text embeddings for the similarity cache (#67). Same shape problem @canonry/ai's
 * replicate.ts already documents for images: `ai-gateway-provider`'s `AiGateway` only
 * ever wraps `LanguageModelV4` chat models (`node_modules/.../ai-gateway-provider/dist/
 * index.d.mts` - `AiGateway.models: InternalLanguageModelV4[]`), never an embedding model,
 * so this calls the gateway's OpenAI-compatible REST proxy directly instead of going
 * through createGateway() - the same reasoning, applied to a different model shape.
 */
import { embed } from 'ai';
import {
	createEmbeddingModel,
	resolveModel,
	withUsage,
	type GatewayCredentials,
	type ModelCallAgent
} from '@canonry/ai';
import type { Db } from '@canonry/db';

export interface EmbeddingProvider {
	embed(text: string): Promise<number[]>;
}

/**
 * Deterministic, credential-free embedding for tests (#67's "test against a local fake").
 * Not a real semantic embedding - it is an L2-normalised character-trigram bag-of-words
 * vector. That gives it the one property the 0.94 threshold test actually needs: near-
 * identical text scores close to 1 by cosine similarity, unrelated text scores well below
 * the threshold, without any network call or credential.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
	public readonly calls: string[] = [];

	constructor(public readonly dimensions = 256) {}

	async embed(text: string): Promise<number[]> {
		this.calls.push(text);
		return trigramEmbedding(text, this.dimensions);
	}
}

function hashString(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return Math.abs(hash);
}

export function trigramEmbedding(text: string, dimensions: number): number[] {
	const vector = new Array<number>(dimensions).fill(0);
	const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
	const padded = `  ${normalized}  `;
	for (let i = 0; i < padded.length - 2; i++) {
		const trigram = padded.slice(i, i + 3);
		const bucket = hashString(trigram) % dimensions;
		vector[bucket] = (vector[bucket] ?? 0) + 1;
	}
	const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
	return norm > 0 ? vector.map((v) => v / norm) : vector;
}

export interface GatewayEmbeddingProviderDeps {
	db: Db;
	credentials: GatewayCredentials;
	userId: string;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
}

/**
 * Resolves the `embedding` purpose `model_config` row and embeds through the AI Gateway
 * (SPEC.md §11.1, now Vercel's).
 *
 * This used to hand-roll an OpenAI-shaped REST call at Cloudflare's provider proxy, with a
 * response-shape guard and a second credential for the provider itself. None of that is needed
 * any more: the gateway addresses models as `provider/model` and the AI SDK's `embed` speaks to
 * it directly, so the request shape is the SDK's problem rather than ours and one credential
 * does the whole job.
 *
 * Priced through `operation_price`'s `media.similarity_check` row at 0 credits (the check exists
 * to avoid paying for a duplicate image, not to produce anything), and still recorded by
 * `withUsage`, so the margin question in SPEC.md §15 stays answerable even when the user is
 * charged nothing.
 */
export class GatewayEmbeddingProvider implements EmbeddingProvider {
	constructor(private readonly deps: GatewayEmbeddingProviderDeps) {}

	async embed(text: string): Promise<number[]> {
		const model = await resolveModel(this.deps.db, 'embedding');
		const result = await withUsage(
			this.deps.db,
			model,
			{
				userId: this.deps.userId,
				universeId: this.deps.universeId,
				agent: this.deps.agent,
				operation: this.deps.operation
			},
			() =>
				embed({
					model: createEmbeddingModel(model.provider, model.modelId, this.deps.credentials),
					value: text
				}),
			{ extractUsage: (r) => ({ embeddingTokens: r.usage?.tokens ?? 0 }) }
		);
		if (result.embedding.length === 0) throw new Error('embedding response carried no vector');
		return result.embedding;
	}
}
