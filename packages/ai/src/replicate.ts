/**
 * Image generation, direct to Replicate (SPEC 11.1's narrowed invariant: text and
 * embeddings go through the Vercel AI Gateway, images and sound go direct to their
 * provider, and every call - gateway or direct - still records itself in `model_call`
 * with its real cost).
 *
 * This used to be the gateway's Replicate REST proxy path (Cloudflare AI Gateway
 * forwarding to `api.replicate.com` so the call stayed logged and costed centrally). That
 * reason is gone twice over: Vercel AI Gateway - the gateway everything else in this
 * package now uses (see gateway.ts) - carries no Replicate model at all (Replicate is an
 * async prediction API, submit input then poll or wait for a result, not a
 * `LanguageModelV4` `generateText`/`streamText` shape), and the product decision (SPEC
 * 11.1) is to keep Replicate direct rather than move images to a gateway-covered model
 * such as `bfl/flux-*`. So this module talks straight to `https://api.replicate.com/v1`,
 * and the accounting that used to be the gateway's job - one `model_call` row per
 * prediction, success or failure, priced and charged via `withQuota` - is unchanged
 * below; going direct only changes who authenticates the outbound request, not whether it
 * is recorded.
 */
import type { Db } from '@canonry/db';
import type { ResolvedModel } from './models.js';
import { withQuota } from './quota.js';
import type { Logger } from './logger.js';
import type { ModelCallAgent } from './usage.js';

/** The real, hardcoded Replicate API host. Production always talks to this; only tests
 * override it via `GenerateImageInput.baseUrl`, pointed at a local HTTP double. */
export const REPLICATE_API_BASE_URL = 'https://api.replicate.com/v1';

export class MissingReplicateEnvError extends Error {
	constructor() {
		super(
			'missing required env var REPLICATE_API_TOKEN: image generation goes direct to ' +
				'Replicate (SPEC 11.1) and cannot authenticate without it. Refusing to fall back ' +
				'to a silent degraded path.'
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
	replicateApiToken: string;
	/** Merged into the Replicate prediction's `input` (prompt plus the entry/style modifier per SPEC 9). */
	input: Record<string, unknown>;
	userId: string;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	/** Retry safety (issue #88): a request retried with the same key charges once.
	 * Threaded straight through to withQuota/recordAndCharge. */
	idempotencyKey?: string;
	logger?: Logger;
	/** Test-only override of the Replicate API host, pointed at a local HTTP double.
	 * Production never sets this - it always talks to REPLICATE_API_BASE_URL. */
	baseUrl?: string;
}

function isReplicatePrediction(value: unknown): value is ReplicatePrediction {
	if (typeof value !== 'object' || value === null) return false;
	if (!('id' in value) || !('status' in value)) return false;
	return typeof value.id === 'string' && typeof value.status === 'string';
}

/**
 * Submits one Replicate prediction directly to api.replicate.com and waits
 * for the result (Replicate's `Prefer: wait` header), recording exactly one
 * `model_call` row - success or failure - and charging the user's balance on
 * success via `withQuota` (issue #88). Pricing is per-image
 * (`params.pricePerImage`, in whichever currency `params.currency` declares - issue
 * #132), not per-token: a prediction has no token usage to extract.
 */
export async function generateImage(params: GenerateImageInput): Promise<ReplicatePrediction> {
	const endpoint = `${params.baseUrl ?? REPLICATE_API_BASE_URL}/models/${params.model.modelId}/predictions`;

	return withQuota(
		params.db,
		params.model,
		{
			userId: params.userId,
			universeId: params.universeId,
			agent: params.agent,
			operation: params.operation,
			...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {})
		},
		async () => {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${params.replicateApiToken}`,
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
