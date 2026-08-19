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
import { setTimeout as sleep } from 'node:timers/promises';
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

/** Replicate's terminal prediction states. Anything else ('starting', 'processing') means
 * the prediction is still in the queue and its `output` is legitimately null. */
const IS_TERMINAL: Record<string, true> = { succeeded: true, failed: true, canceled: true };

/** A prediction Replicate accepted and then finished without an image: refused for content,
 * cancelled, or crashed. Distinct from ReplicateRequestError, which is the submission being
 * rejected outright, because this one has already consumed provider capacity. */
export class ReplicatePredictionFailedError extends Error {
	constructor(
		public readonly predictionId: string,
		public readonly status: string
	) {
		super(`Replicate prediction "${predictionId}" ended as "${status}"`);
		this.name = 'ReplicatePredictionFailedError';
	}
}

/** The prediction was still queued when the wait budget ran out. Thrown from inside
 * `withQuota`'s callback on purpose: that is what keeps the user's balance untouched for an
 * image they never received. */
export class ReplicatePredictionTimeoutError extends Error {
	constructor(
		public readonly predictionId: string,
		waitedMs: number
	) {
		super(
			`Replicate prediction "${predictionId}" was still queued after ${Math.round(waitedMs / 1000)}s`
		);
		this.name = 'ReplicatePredictionTimeoutError';
	}
}

/** How long to keep waiting for a queued prediction after `Prefer: wait` gives up, and how
 * often to ask. Replicate caps the synchronous wait at 60 seconds and then hands back a
 * `processing` prediction with a 2xx status, so 60 seconds is the floor rather than the
 * ceiling of what a busy queue can cost; three more minutes covers a cold start on a
 * throttled account without leaving a web request hanging indefinitely. */
const POLL_BUDGET_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Submits one Replicate prediction directly to api.replicate.com and waits for the result,
 * recording exactly one `model_call` row - success or failure - and charging the user's
 * balance on success via `withQuota` (issue #88). Pricing is per-image
 * (`params.pricePerImage`, in whichever currency `params.currency` declares - issue
 * #132), not per-token: a prediction has no token usage to extract.
 *
 * `Prefer: wait` is asked for but never trusted, which #258 found the hard way. On a
 * throttled account Replicate held the connection the full 60 seconds and then answered
 * `202` with `status: "processing"` and `output: null`; the callback returned that happily,
 * `withQuota` read it as a success and charged three credits, and the caller then threw
 * "returned no image output". A queued prediction charging for nothing is the worst
 * possible reading of a slow queue, so the callback now polls to a terminal state and
 * throws on anything that is not `succeeded`, which is what keeps the charge and the image
 * in step.
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

			let prediction = json;
			const startedAt = Date.now();
			while (!IS_TERMINAL[prediction.status]) {
				const waited = Date.now() - startedAt;
				if (waited >= POLL_BUDGET_MS) {
					throw new ReplicatePredictionTimeoutError(prediction.id, waited);
				}
				await sleep(POLL_INTERVAL_MS);
				const poll = await fetch(
					`${params.baseUrl ?? REPLICATE_API_BASE_URL}/predictions/${prediction.id}`,
					{ headers: { authorization: `Bearer ${params.replicateApiToken}` } }
				);
				if (!poll.ok) {
					const bodyText = await poll.text();
					throw new ReplicateRequestError(poll.status, `${bodyText.length} byte body`);
				}
				const polled: unknown = await poll.json();
				if (!isReplicatePrediction(polled)) {
					throw new Error('Replicate poll response did not look like a prediction');
				}
				prediction = polled;
			}
			if (prediction.status !== 'succeeded') {
				throw new ReplicatePredictionFailedError(prediction.id, prediction.status);
			}
			return prediction;
		},
		{
			...(params.logger ? { logger: params.logger } : {}),
			extractUsage: () => ({ images: 1 })
		}
	);
}
