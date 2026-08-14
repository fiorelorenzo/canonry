/**
 * Maps a verified Stripe webhook event onto `@canonry/db`'s provider-agnostic
 * `SubscriptionWebhookEvent` (issue #91). This is the one place that knows what a real
 * Stripe payload looks like - `applySubscriptionWebhookEvent` and its whole test suite
 * never do, by design (subscriptions.ts's own header comment states the same
 * driver-boundary rule `AGENTS.md` states for packages/import).
 *
 * Two events are handled, both traced to a documented, stable Stripe behaviour rather
 * than guessed at:
 *
 * - `invoice.paid`: the userId/planId this deployment set on `subscription_data.metadata`
 *   at checkout (provider.ts) come back on `data.object.subscription_details.metadata` -
 *   "the invoice's subscription_details.metadata attribute always contains the
 *   subscription's metadata at the time of invoice creation" per
 *   docs.stripe.com/billing/invoices/subscription. The period comes from the first line
 *   item's own `period.start`/`period.end` - "for subscription line items, this is the
 *   subscription period" per docs.stripe.com/api/invoice-line-item.
 * - `customer.subscription.deleted`: `data.object` *is* the Subscription, so its own
 *   `metadata.userId` is unambiguous - no inheritance to reason about.
 *
 * Every other event type returns null - the webhook route acks it (200) without calling
 * applySubscriptionWebhookEvent, per Stripe's own guidance to acknowledge event types you
 * do not act on rather than erroring, which would only earn a pointless retry.
 */
import type { SubscriptionWebhookEvent } from '@canonry/db';

export class MalformedStripeEventError extends Error {
	constructor(eventType: string, reason: string) {
		super(`Stripe "${eventType}" event is missing what it needs: ${reason}`);
		this.name = 'MalformedStripeEventError';
	}
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
	const value = obj[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function normalizeInvoicePaid(
	eventId: string,
	occurredAt: Date,
	invoice: Record<string, unknown>
): SubscriptionWebhookEvent {
	const metadata = asRecord(asRecord(invoice.subscription_details)?.metadata);
	const userId = metadata && stringField(metadata, 'userId');
	const planId = metadata && stringField(metadata, 'planId');
	if (!userId || !planId) {
		throw new MalformedStripeEventError(
			'invoice.paid',
			'data.object.subscription_details.metadata.userId/planId - set at checkout via ' +
				'subscription_data.metadata (provider.ts) and expected to survive onto every ' +
				'invoice Stripe generates for the subscription'
		);
	}

	const lines = asRecord(invoice.lines);
	const firstLine = Array.isArray(lines?.data) ? asRecord(lines.data[0]) : undefined;
	const period = asRecord(firstLine?.period);
	const periodStartSeconds = typeof period?.start === 'number' ? period.start : undefined;
	const periodEndSeconds = typeof period?.end === 'number' ? period.end : undefined;
	if (periodStartSeconds === undefined || periodEndSeconds === undefined) {
		throw new MalformedStripeEventError(
			'invoice.paid',
			'data.object.lines.data[0].period.start/end'
		);
	}

	return {
		id: eventId,
		type: 'invoice.paid',
		occurredAt,
		userId,
		planId,
		periodStart: new Date(periodStartSeconds * 1000),
		periodEnd: new Date(periodEndSeconds * 1000)
	};
}

function normalizeSubscriptionDeleted(
	eventId: string,
	occurredAt: Date,
	subscription: Record<string, unknown>
): SubscriptionWebhookEvent {
	const metadata = asRecord(subscription.metadata);
	const userId = metadata && stringField(metadata, 'userId');
	if (!userId) {
		throw new MalformedStripeEventError(
			'customer.subscription.deleted',
			'data.object.metadata.userId'
		);
	}
	return { id: eventId, type: 'customer.subscription.deleted', occurredAt, userId };
}

/** `payload` is the already-JSON.parsed, signature-verified webhook body. Returns null
 * for an event type this deployment does not act on; throws MalformedStripeEventError
 * for an event type it does act on but whose payload is missing the field this file's
 * header comment cites - a real bug (a Stripe API version drift, or a checkout session
 * that somehow skipped setting metadata) worth failing loudly on rather than silently
 * dropping a payment's credit grant. */
export function normalizeStripeEvent(payload: unknown): SubscriptionWebhookEvent | null {
	const event = asRecord(payload);
	const eventId = event && stringField(event, 'id');
	const eventType = event && stringField(event, 'type');
	const createdSeconds = event && typeof event.created === 'number' ? event.created : undefined;
	const object = asRecord(asRecord(event?.data)?.object);
	if (!event || !eventId || !eventType || createdSeconds === undefined || !object) {
		throw new MalformedStripeEventError(
			String(eventType ?? 'unknown'),
			'top-level id/type/created/data.object'
		);
	}
	const occurredAt = new Date(createdSeconds * 1000);

	switch (eventType) {
		case 'invoice.paid':
			return normalizeInvoicePaid(eventId, occurredAt, object);
		case 'customer.subscription.deleted':
			return normalizeSubscriptionDeleted(eventId, occurredAt, object);
		default:
			return null;
	}
}
