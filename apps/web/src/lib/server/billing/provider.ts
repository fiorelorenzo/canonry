/**
 * The provider boundary issue #91 asks for: checkout initiation and webhook parsing
 * behind an interface, so the DB-level grant logic (`@canonry/db`'s
 * `applySubscriptionWebhookEvent`) and its tests never import Stripe, and a test double
 * can stand in for `StripeProvider` without touching the network. `StripeProvider` is the
 * only production implementation - never swapped for a fake behind an env switch, the
 * same rule `$lib/server/media.ts` states for Replicate: "this box has no
 * REPLICATE_API_TOKEN, so a generate request here throws... until one is configured;
 * that is the honest behaviour, not a silent fallback."
 *
 * Talks to Stripe's REST API directly with `fetch`, the same choice `packages/ai`'s
 * replicate.ts made for Replicate: one dependency-free HTTP call does not earn a new
 * package dependency, and this box cannot `pnpm add stripe` anyway (session constraint -
 * ask and keep working).
 */
import { normalizeStripeEvent, type MalformedStripeEventError } from './stripe-events.js';
import { verifyStripeSignature, InvalidWebhookSignatureError } from './stripe-signature.js';
import type { SubscriptionWebhookEvent } from '@canonry/db';

export { InvalidWebhookSignatureError, type MalformedStripeEventError };

export interface StripeCredentials {
	secretKey: string;
	webhookSecret: string;
}

export class MissingStripeEnvError extends Error {
	constructor(varName: string) {
		super(
			`missing required env var ${varName}: this deployment has no Stripe account configured ` +
				'(issue #91 - see the issue for the exact blocker). Checkout initiation and webhook ' +
				'verification refuse rather than silently no-op.'
		);
		this.name = 'MissingStripeEnvError';
	}
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value) throw new MissingStripeEnvError(name);
	return value;
}

export function readStripeCredentials(env: NodeJS.ProcessEnv = process.env): StripeCredentials {
	return {
		secretKey: requireEnv(env, 'STRIPE_SECRET_KEY'),
		webhookSecret: requireEnv(env, 'STRIPE_WEBHOOK_SECRET')
	};
}

export class StripeRequestError extends Error {
	constructor(
		public readonly status: number,
		body: string
	) {
		super(`Stripe API request failed with ${status}: ${body}`);
		this.name = 'StripeRequestError';
	}
}

export interface CheckoutSessionInput {
	userId: string;
	planId: string;
	planName: string;
	priceEurPerMonth: number;
	successUrl: string;
	cancelUrl: string;
}

export interface CheckoutSession {
	id: string;
	url: string;
}

/**
 * Checkout initiation and webhook parsing, kept to exactly the two operations #91 needs
 * behind one seam - a settings-page action calls `createCheckoutSession`, the webhook
 * route calls `parseWebhookEvent`, and neither knows which implementation is behind it.
 */
export interface PaymentProvider {
	createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
	/** Verifies `signatureHeader` against `rawBody` and normalizes the payload. Throws
	 * InvalidWebhookSignatureError on a bad signature, MalformedStripeEventError on an
	 * event type this deployment acts on but cannot make sense of. Returns null for an
	 * event type it does not act on - still a verified, legitimate delivery, just not one
	 * that changes anything here. */
	parseWebhookEvent(
		rawBody: string,
		signatureHeader: string | null
	): SubscriptionWebhookEvent | null;
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export class StripeProvider implements PaymentProvider {
	constructor(private readonly credentials: StripeCredentials = readStripeCredentials()) {}

	async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
		// Inline price_data rather than a pre-created Stripe Price object: this deployment
		// has no Stripe account to have created one in (the exact blocker documented on
		// #91), and price_data is Stripe's own documented way to define a recurring price
		// at checkout time without one.
		const body = new URLSearchParams({
			mode: 'subscription',
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			client_reference_id: input.userId,
			'metadata[userId]': input.userId,
			'metadata[planId]': input.planId,
			// Copied onto the created Subscription (docs.stripe.com/metadata/use-cases), and
			// from there onto every invoice's subscription_details.metadata
			// (docs.stripe.com/billing/invoices/subscription) - stripe-events.ts's
			// normalizeStripeEvent reads it back from exactly there.
			'subscription_data[metadata][userId]': input.userId,
			'subscription_data[metadata][planId]': input.planId,
			'line_items[0][quantity]': '1',
			'line_items[0][price_data][currency]': 'eur',
			'line_items[0][price_data][unit_amount]': String(Math.round(input.priceEurPerMonth * 100)),
			'line_items[0][price_data][recurring][interval]': 'month',
			'line_items[0][price_data][product_data][name]': `Canonry ${input.planName}`
		});

		const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${Buffer.from(`${this.credentials.secretKey}:`).toString('base64')}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body
		});
		if (!response.ok) throw new StripeRequestError(response.status, await response.text());

		const json = (await response.json()) as { id?: unknown; url?: unknown };
		if (typeof json.id !== 'string' || typeof json.url !== 'string') {
			throw new StripeRequestError(response.status, 'checkout session response had no id/url');
		}
		return { id: json.id, url: json.url };
	}

	parseWebhookEvent(
		rawBody: string,
		signatureHeader: string | null
	): SubscriptionWebhookEvent | null {
		verifyStripeSignature(rawBody, signatureHeader, this.credentials.webhookSecret);
		return normalizeStripeEvent(JSON.parse(rawBody));
	}
}
