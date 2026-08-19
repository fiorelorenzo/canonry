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

/** Replicate throttles prediction creation hard while an account holds under $5 in
 * credit (issue #334) - its 429 answers with a `Retry-After` header and a `retry_after`
 * field in the body, both the same number of seconds in every response seen so far
 * ("Your rate limit resets in ~10s"). Thrown once `submitPrediction` below has honoured
 * that as far as its bound allows and Replicate is still throttling, or when a 429
 * carries no usable `retry_after` to honour at all - either way this is the caller's
 * signal that the account is throttled, not that one particular request was rejected. */
export class ReplicateThrottledError extends Error {
	constructor(
		public readonly attempts: number,
		public readonly waitedMs: number
	) {
		super(
			`Replicate throttled prediction creation (429) after ${attempts} attempt` +
				`${attempts === 1 ? '' : 's'} and ${Math.round(waitedMs / 1000)}s of retrying`
		);
		this.name = 'ReplicateThrottledError';
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

/** How much total waiting a throttled submission gets before generateImage gives up and
 * surfaces ReplicateThrottledError, and the ceiling on how many 429s in a row it will
 * honour getting there (issue #334). Budgeted in *waited* time rather than a fixed
 * attempt count, because retry_after is Replicate's own number for how long its window
 * takes to reopen: the observed shape is one ~10s wait clearing the throttle (the bench
 * paces submissions 11s apart for the same reason - packages/bench/src/media/scene.ts),
 * so 30 seconds covers a couple of unlucky retries without turning a GM's "Generating..."
 * into a minutes-long silent hang. The attempt cap is the cheaper backstop for the one
 * case the time budget alone cannot catch - Replicate answering `retry_after: 0` - since
 * a real throttle always costs at least the wait to clear. */
const THROTTLE_BUDGET_MS = 30_000;
const MAX_THROTTLE_ATTEMPTS = 6;

/** Reads how long Replicate wants this submission to wait before trying again: the
 * `Retry-After` header first (the generic HTTP shape), the JSON body's own `retry_after`
 * field as a fallback (what issue #334's captured response carried on both, in
 * lockstep). Null means Replicate gave no usable number to honour. */
function parseRetryAfterMs(response: Response, bodyText: string): number | null {
	const headerSeconds = Number.parseFloat(response.headers.get('retry-after') ?? '');
	if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return headerSeconds * 1000;
	try {
		const parsed = JSON.parse(bodyText) as { retry_after?: unknown };
		if (typeof parsed.retry_after === 'number' && Number.isFinite(parsed.retry_after)) {
			return Math.max(0, parsed.retry_after) * 1000;
		}
	} catch {
		// Body wasn't JSON, or had no retry_after - nothing left to fall back to.
	}
	return null;
}

/** Submits the prediction, retrying in place on a 429 (issue #334) rather than handing
 * one straight to `withQuota` as a failure. This runs entirely inside `generateImage`'s
 * `withQuota` callback - the same place #258's poll loop already lives - on purpose: a
 * submission that gets through on its second or third try is still exactly one
 * `model_call` row and one charge. A row per retry would make the metrics lie about how
 * many generations were actually attempted; retrying outside `withQuota` (a fresh
 * `generateImage` call per attempt) would do exactly that. It also runs inside the
 * caller's `ProviderLimiter` slot, for the same reason #258's poll does: the slot caps
 * how many Replicate submissions this process has in flight at once, and a throttled
 * submission that has not gotten through yet is still one of those, not a finished call
 * waiting on something unrelated the way the CDN download after it is. */
async function submitPrediction(
	endpoint: string,
	token: string,
	input: Record<string, unknown>
): Promise<unknown> {
	let waitedMs = 0;
	for (let attempt = 1; attempt <= MAX_THROTTLE_ATTEMPTS; attempt++) {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
				prefer: 'wait'
			},
			body: JSON.stringify({ input })
		});
		if (response.ok) return response.json();

		// Body may echo request input back; never let it reach the logger or an error
		// message, only its length and (for a 429) its retry_after field do.
		const bodyText = await response.text();
		if (response.status !== 429) {
			throw new ReplicateRequestError(response.status, `${bodyText.length} byte body`);
		}
		const retryAfterMs = parseRetryAfterMs(response, bodyText);
		if (
			retryAfterMs === null ||
			waitedMs + retryAfterMs > THROTTLE_BUDGET_MS ||
			attempt === MAX_THROTTLE_ATTEMPTS
		) {
			throw new ReplicateThrottledError(attempt, waitedMs);
		}
		await sleep(retryAfterMs);
		waitedMs += retryAfterMs;
	}
	// Unreachable - the loop above always returns or throws before falling off the end,
	// but TS can't see that from a `for` loop alone.
	throw new ReplicateThrottledError(MAX_THROTTLE_ATTEMPTS, waitedMs);
}

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
 *
 * Submission itself retries in place on a 429 (issue #334, see `submitPrediction`
 * above): Replicate throttles prediction creation hard under $5 of account credit, and
 * without this a GM who clicks Generate while throttled just sees a failed generation
 * with no hint that waiting ten seconds was the whole fix.
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
			const json = await submitPrediction(endpoint, params.replicateApiToken, params.input);
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
