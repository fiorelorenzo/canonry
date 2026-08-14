/**
 * Stripe's webhook signature scheme (issue #91), implemented against the documented
 * algorithm rather than the `stripe` SDK - this codebase never adds a dependency for one
 * function, the same reasoning `packages/ai`'s replicate.ts and this package's own
 * provider.ts already apply to Replicate and Stripe's REST API.
 *
 * Header shape: `Stripe-Signature: t=<unix-seconds>,v1=<hex-hmac>[,v1=<hex-hmac>...]`
 * (multiple `v1` entries appear during a webhook secret rotation - Stripe signs with
 * every active secret at once, and a valid match against any one of them is a valid
 * signature). The signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint's
 * webhook secret, hex-encoded. Verified against docs.stripe.com/webhooks/signature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export class InvalidWebhookSignatureError extends Error {
	constructor(reason: string) {
		super(`Stripe webhook signature is invalid: ${reason}`);
		this.name = 'InvalidWebhookSignatureError';
	}
}

/** Stripe's own recommendation - a signature older than this is a replay attempt using a
 * captured header, not a fresh delivery, even if the HMAC itself still matches. */
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } {
	const timestamp: string[] = [];
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, value] = part.split('=', 2);
		if (key === 't' && value) timestamp.push(value);
		if (key === 'v1' && value) signatures.push(value);
	}
	if (timestamp.length !== 1 || signatures.length === 0) {
		throw new InvalidWebhookSignatureError(
			`expected "t=<seconds>,v1=<hex>[,v1=<hex>...]", got "${header}"`
		);
	}
	return { timestamp: timestamp[0]!, signatures };
}

function safeEqualHex(expectedHex: string, candidateHex: string): boolean {
	// timingSafeEqual throws on a length mismatch rather than returning false, and a
	// forged signature of the wrong length is exactly the case this must not leak
	// through a thrown-vs-returned distinction - so this checks length first and
	// returns false rather than letting an attacker distinguish "wrong length" from
	// "wrong bytes" by which code path executes.
	const expected = Buffer.from(expectedHex, 'hex');
	const candidate = Buffer.from(candidateHex, 'hex');
	if (expected.length !== candidate.length) return false;
	return timingSafeEqual(expected, candidate);
}

/**
 * Verifies a Stripe webhook delivery. Throws InvalidWebhookSignatureError on anything
 * that does not check out - a malformed header, no signature matching the computed HMAC
 * under any active secret, or a timestamp outside the tolerance window. Never returns a
 * boolean: a webhook route has no correct action to take on a signature it did not
 * actually verify, so there is no caller that should be able to ignore the return value.
 */
export function verifyStripeSignature(
	rawBody: string,
	signatureHeader: string | null,
	webhookSecret: string,
	options: { toleranceSeconds?: number; now?: () => number } = {}
): void {
	if (!signatureHeader) {
		throw new InvalidWebhookSignatureError('missing Stripe-Signature header');
	}
	const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

	const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
	const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
	const eventSeconds = Number.parseInt(timestamp, 10);
	if (!Number.isFinite(eventSeconds)) {
		throw new InvalidWebhookSignatureError(`timestamp "${timestamp}" is not a number`);
	}
	if (Math.abs(nowSeconds - eventSeconds) > tolerance) {
		throw new InvalidWebhookSignatureError(
			`timestamp ${timestamp} is outside the ${tolerance}s tolerance window - possible replay`
		);
	}

	const expectedHex = createHmac('sha256', webhookSecret)
		.update(`${timestamp}.${rawBody}`, 'utf8')
		.digest('hex');
	const matches = signatures.some((candidate) => safeEqualHex(expectedHex, candidate));
	if (!matches) {
		throw new InvalidWebhookSignatureError('no v1 signature matched the computed HMAC');
	}
}
