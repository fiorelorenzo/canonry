/**
 * Text embeddings for the similarity cache (#67). Same shape problem @canonry/ai's
 * replicate.ts already documents for images: `ai-gateway-provider`'s `AiGateway` only
 * ever wraps `LanguageModelV4` chat models (`node_modules/.../ai-gateway-provider/dist/
 * index.d.mts` - `AiGateway.models: InternalLanguageModelV4[]`), never an embedding model,
 * so this calls the gateway's OpenAI-compatible REST proxy directly instead of going
 * through createGateway() - the same reasoning, applied to a different model shape.
 */
import { resolveModel, withUsage, type GatewayCredentials, type ModelCallAgent } from '@canonry/ai';
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

export class MissingEmbeddingApiTokenError extends Error {
	constructor() {
		super(
			"missing required env var EMBEDDING_API_TOKEN: the similarity cache's embedding " +
				'call is BYOK on the gateway (SPEC 8.2/9) and cannot authenticate without it.'
		);
		this.name = 'MissingEmbeddingApiTokenError';
	}
}

export function readEmbeddingApiToken(env: NodeJS.ProcessEnv = process.env): string {
	const token = env.EMBEDDING_API_TOKEN;
	if (!token) throw new MissingEmbeddingApiTokenError();
	return token;
}

/** Mirrors @canonry/ai/src/gateway.ts's CLOUDFLARE_GATEWAY_HOST, which that package does
 * not re-export from its public surface - see this file's header for why an embedding
 * call cannot go through createGateway() and has to build this URL itself, exactly like
 * replicateGatewayBaseUrl does for images. */
const CLOUDFLARE_GATEWAY_HOST = 'https://gateway.ai.cloudflare.com';

function embeddingGatewayUrl(credentials: GatewayCredentials, provider: string): string {
	const host = credentials.baseUrl ?? CLOUDFLARE_GATEWAY_HOST;
	return `${host}/v1/${credentials.accountId}/${credentials.gateway}/${provider}/embeddings`;
}

interface OpenAiEmbeddingResponse {
	data: Array<{ embedding: number[] }>;
	usage?: { total_tokens?: number };
}

function isOpenAiEmbeddingResponse(value: unknown): value is OpenAiEmbeddingResponse {
	if (typeof value !== 'object' || value === null) return false;
	if (!('data' in value) || !Array.isArray(value.data)) return false;
	return value.data.every((item) => {
		if (typeof item !== 'object' || item === null) return false;
		return 'embedding' in item && Array.isArray(item.embedding);
	});
}

export class EmbeddingRequestError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(`embedding request failed with status ${status}: ${message}`);
		this.name = 'EmbeddingRequestError';
	}
}

export interface GatewayEmbeddingProviderDeps {
	db: Db;
	credentials: GatewayCredentials;
	apiToken: string;
	userId: string;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
}

/**
 * Resolves the 'embedding' purpose model_config row and calls the gateway's
 * OpenAI-compatible REST proxy directly (see header). Priced through operation_price's
 * media.similarity_check row (0 credits - the check exists to prevent a charge, not to
 * produce anything) via withUsage, so every call still lands a model_call row for the
 * margin question (SPEC.md §15) even though nothing is spent.
 *
 * UNVERIFIED end-to-end in this sandbox: there is no EMBEDDING_API_TOKEN or a configured
 * model_config row for purpose 'embedding' here. embedding.test.ts proves the request
 * shape and the withUsage/pricing wiring against a local HTTP double with a stubbed
 * model_config row - what only a real token and a real embedding model prove is that the
 * gateway's OpenAI-compatible proxy actually accepts this request shape for whichever
 * provider ends up configured for 'embedding'.
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
			async () => {
				const response = await fetch(embeddingGatewayUrl(this.deps.credentials, model.provider), {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						authorization: `Bearer ${this.deps.apiToken}`,
						'cf-aig-authorization': `Bearer ${this.deps.credentials.apiKey}`
					},
					body: JSON.stringify({ model: model.modelId, input: text })
				});
				if (!response.ok) {
					const bodyText = await response.text();
					throw new EmbeddingRequestError(response.status, `${bodyText.length} byte body`);
				}
				const json: unknown = await response.json();
				if (!isOpenAiEmbeddingResponse(json)) {
					throw new Error(
						'embedding response did not look like an OpenAI-shaped embeddings response'
					);
				}
				return json;
			},
			{ extractUsage: (r) => ({ embeddingTokens: r.usage?.total_tokens ?? 0 }) }
		);

		const vector = result.data[0]?.embedding;
		if (!vector) throw new Error('embedding response carried no vectors');
		return vector;
	}
}
