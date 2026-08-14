/**
 * Server-side glue for /settings/billing (#91): plan lookup, checkout initiation through
 * the PaymentProvider seam, and the webhook's DB write path. Mirrors keys.ts's role for
 * /settings/keys - the route files stay thin SvelteKit load/actions shapes.
 */
import { env } from '$env/dynamic/private';
import {
	applySubscriptionWebhookEvent,
	getBalance,
	getSubscriptionPlan,
	SUBSCRIPTION_PLANS,
	type ApplyWebhookEventResult,
	type Balance,
	type SubscriptionPlan
} from '@canonry/db';
import { db } from '../db.js';
import {
	readStripeCredentials,
	StripeProvider,
	type CheckoutSession,
	type PaymentProvider
} from './provider.js';

export { SUBSCRIPTION_PLANS, type Balance, type SubscriptionPlan };

export interface BillingSummary {
	balance: Balance;
	/** undefined only if `balance.plan` names a plan this deployment stopped selling -
	 * the settings page still has to render something for an account stuck on a retired
	 * plan rather than crashing. */
	plan: SubscriptionPlan | undefined;
}

export async function billingSummaryFor(userId: string): Promise<BillingSummary> {
	const balance = await getBalance(db(), userId);
	return { balance, plan: getSubscriptionPlan(balance.plan) };
}

let provider: PaymentProvider | undefined;

/** Always the real Stripe implementation - see provider.ts's header for why this is
 * never swapped for a fake behind an env switch in production code. Constructed lazily,
 * and only from a checkout action or the webhook route: `billingSummaryFor` above never
 * calls this, so /settings/billing still renders plan and balance on a deployment with
 * no Stripe credentials configured at all - only the "start checkout" action needs them,
 * and it is where MissingStripeEnvError is meant to surface. */
export function paymentProvider(): PaymentProvider {
	if (!provider) provider = new StripeProvider(readStripeCredentials(env));
	return provider;
}

export async function startCheckout(
	userId: string,
	planId: string,
	origin: string
): Promise<CheckoutSession> {
	const plan = getSubscriptionPlan(planId);
	if (!plan) throw new Error(`startCheckout: no plan named "${planId}"`);
	return paymentProvider().createCheckoutSession({
		userId,
		planId: plan.id,
		planName: plan.name,
		priceEurPerMonth: plan.priceEurPerMonth,
		successUrl: `${origin}/settings/billing?checkout=success`,
		cancelUrl: `${origin}/settings/billing?checkout=cancelled`
	});
}

export interface WebhookOutcome {
	/** False for a verified delivery of an event type this deployment does not act on -
	 * still a 200, just nothing to report. */
	handled: boolean;
	result?: ApplyWebhookEventResult;
}

/** The webhook route's only DB-touching call - `parseWebhookEvent` (provider.ts) both
 * verifies the signature and normalizes the payload, so a malformed or unsigned request
 * throws before this function does anything else. `provider` defaults to the real
 * `paymentProvider()` singleton and is only ever overridden from webhook.test.ts, which
 * exercises this exact function - replayed and out-of-order events included - against a
 * fake provider instead of a real Stripe signature (issue #91's acceptance criteria: the
 * one thing about payments this box can test without a Stripe account). */
export async function receiveWebhook(
	rawBody: string,
	signatureHeader: string | null,
	provider: PaymentProvider = paymentProvider()
): Promise<WebhookOutcome> {
	const event = provider.parseWebhookEvent(rawBody, signatureHeader);
	if (!event) return { handled: false };
	const result = await applySubscriptionWebhookEvent(db(), event);
	return { handled: true, result };
}
