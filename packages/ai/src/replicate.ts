/**
 * Image generation through the gateway's Replicate proxy (SPEC 9, 11.1):
 * text and images share one gateway so logs, caching and cost live in the
 * same place.
 *
 * ai-gateway-provider 4.0.0 ships no Replicate model factory - its
 * `providers/*` subpaths cover openai, anthropic, google, azure, mistral,
 * groq, xai, cerebras, cohere, deepgram, elevenlabs, fireworks, google-vertex,
 * openrouter, amazon-bedrock, perplexity and the generic `unified` compat
 * endpoint, but not replicate (see node_modules/ai-gateway-provider's
 * `package.json#exports` and `dist/providers/index.d.mts`). That tracks:
 * Replicate is not a `LanguageModelV4` - it is an async prediction API
 * (submit input, poll or wait for a result), which does not fit
 * `generateText`/`streamText` at all, and `AiGatewayChatLanguageModel` only
 * ever wraps `LanguageModelV4` implementations. The gateway-core provider
 * table (dist/index.mjs) does recognise `api.replicate.com` for host
 * detection - that recognition exists for the *binding* fallback-array path
 * with a hypothetical Replicate SDK model, not for a REST proxy caller like
 * this one.
 *
 * So this module does not, and cannot, route through `createAiGateway()`.
 * Instead it calls the gateway's documented provider-specific REST proxy
 * directly (`/v1/{account}/{gateway}/replicate/...`, the same path SPEC 11.1
 * names), which is exactly what that proxy is for: forwarding a REST call to
 * Replicate through the gateway so it is still logged, cached and costed
 * there. This is not a workaround for a missing feature; it is the
 * documented shape of a REST passthrough provider on this gateway.
 */
import type { Db } from '@canonry/db';
import { type GatewayCredentials, replicateGatewayBaseUrl } from './gateway.js';
import type { ResolvedModel } from './models.js';
import { withUsage, type ModelCallAgent } from './usage.js';
import type { Logger } from './logger.js';

export class MissingReplicateEnvError extends Error {
	constructor() {
		super(
			'missing required env var REPLICATE_API_TOKEN: image generation is BYOK on the gateway ' +
				'(SPEC 9) and cannot authenticate to Replicate without it.'
		);
		this.name = 'MissingReplicateEnvError';
	}
}

export function readReplicateApiToken(env: NodeJS.ProcessEnv = process.env): string {
	const token = env.REPLICATE_API_TOKEN;
	if (!token) throw new MissingReplicateEnvError();
	return token;
}

export interface ReplicatePrediction {
	id: string;
	status: string;
	output?: unknown;
	error?: string | null;
}

export class ReplicateRequestError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(`Replicate request failed with status ${status}: ${message}`);
		this.name = 'ReplicateRequestError';
	}
}

export interface GenerateImageInput {
	db: Db;
	/** A resolved `model_config` row for purpose 'image' (SPEC 9). */
	model: ResolvedModel;
	credentials: GatewayCredentials;
	replicateApiToken: string;
	/** Merged into the Replicate prediction's `input` (prompt plus the entry/style modifier per SPEC 9). */
	input: Record<string, unknown>;
	userId: string;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	logger?: Logger;
}

function isReplicatePrediction(value: unknown): value is ReplicatePrediction {
	if (typeof value !== 'object' || value === null) return false;
	if (!('id' in value) || !('status' in value)) return false;
	return typeof value.id === 'string' && typeof value.status === 'string';
}

/**
 * Submits one Replicate prediction through the gateway's Replicate proxy and
 * waits for the result (Replicate's `Prefer: wait` header), recording exactly
 * one `model_call` row - success or failure - via `withUsage`. Pricing is
 * per-image (`params.eurPerImage`), not per-token: a prediction has no token
 * usage to extract.
 */
export async function generateImage(params: GenerateImageInput): Promise<ReplicatePrediction> {
	const endpoint = `${replicateGatewayBaseUrl(params.credentials)}/v1/models/${params.model.modelId}/predictions`;

	return withUsage(
		params.db,
		params.model,
		{
			userId: params.userId,
			universeId: params.universeId,
			agent: params.agent,
			operation: params.operation
		},
		async () => {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${params.replicateApiToken}`,
					'cf-aig-authorization': `Bearer ${params.credentials.apiKey}`,
					prefer: 'wait'
				},
				body: JSON.stringify({ input: params.input })
			});
			if (!response.ok) {
				// Body may echo request input back; never let it reach the logger,
				// only the status code and a truncated length do.
				const bodyText = await response.text();
				throw new ReplicateRequestError(response.status, `${bodyText.length} byte body`);
			}
			const json: unknown = await response.json();
			if (!isReplicatePrediction(json)) {
				throw new Error('Replicate response did not look like a prediction');
			}
			return json;
		},
		{
			...(params.logger ? { logger: params.logger } : {}),
			extractUsage: () => ({ images: 1 })
		}
	);
}
