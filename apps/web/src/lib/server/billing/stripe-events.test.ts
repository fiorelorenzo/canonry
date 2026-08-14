import { describe, expect, it } from 'vitest';
import { MalformedStripeEventError, normalizeStripeEvent } from './stripe-events.js';

function invoicePaidPayload(overrides: {
	id?: string;
	created?: number;
	userId?: string | null;
	planId?: string | null;
	periodStart?: number | null;
	periodEnd?: number | null;
}) {
	return {
		id: overrides.id ?? 'evt_invoice_1',
		object: 'event',
		type: 'invoice.paid',
		created: overrides.created ?? 1_800_000_000,
		data: {
			object: {
				id: 'in_1',
				subscription_details:
					overrides.userId === null
						? null
						: {
								metadata: {
									userId: overrides.userId ?? 'user_123',
									planId: overrides.planId ?? 'plus'
								}
							},
				lines: {
					data:
						overrides.periodStart === null
							? []
							: [
									{
										period: {
											start: overrides.periodStart ?? 1_800_000_000,
											end: overrides.periodEnd ?? 1_802_592_000
										}
									}
								]
				}
			}
		}
	};
}

function subscriptionDeletedPayload(overrides: { userId?: string | null }) {
	return {
		id: 'evt_sub_deleted_1',
		object: 'event',
		type: 'customer.subscription.deleted',
		created: 1_800_000_000,
		data: {
			object: {
				id: 'sub_1',
				metadata: overrides.userId === null ? {} : { userId: overrides.userId ?? 'user_123' }
			}
		}
	};
}

describe('normalizeStripeEvent - invoice.paid', () => {
	it('reads userId/planId from subscription_details.metadata and the period from the first line item', () => {
		const event = normalizeStripeEvent(
			invoicePaidPayload({
				userId: 'user_abc',
				planId: 'plus',
				periodStart: 1_800_000_000,
				periodEnd: 1_802_592_000
			})
		);

		expect(event).toEqual({
			id: 'evt_invoice_1',
			type: 'invoice.paid',
			occurredAt: new Date(1_800_000_000 * 1000),
			userId: 'user_abc',
			planId: 'plus',
			periodStart: new Date(1_800_000_000 * 1000),
			periodEnd: new Date(1_802_592_000 * 1000)
		});
	});

	it('throws MalformedStripeEventError when subscription_details.metadata is missing', () => {
		expect(() => normalizeStripeEvent(invoicePaidPayload({ userId: null }))).toThrow(
			MalformedStripeEventError
		);
	});

	it('throws MalformedStripeEventError when there is no line item to read a period from', () => {
		expect(() => normalizeStripeEvent(invoicePaidPayload({ periodStart: null }))).toThrow(
			MalformedStripeEventError
		);
	});
});

describe('normalizeStripeEvent - customer.subscription.deleted', () => {
	it('reads userId directly off the subscription object', () => {
		const event = normalizeStripeEvent(subscriptionDeletedPayload({ userId: 'user_xyz' }));
		expect(event).toEqual({
			id: 'evt_sub_deleted_1',
			type: 'customer.subscription.deleted',
			occurredAt: new Date(1_800_000_000 * 1000),
			userId: 'user_xyz'
		});
	});

	it('throws MalformedStripeEventError when metadata.userId is missing', () => {
		expect(() => normalizeStripeEvent(subscriptionDeletedPayload({ userId: null }))).toThrow(
			MalformedStripeEventError
		);
	});
});

describe('normalizeStripeEvent - event types this deployment does not act on', () => {
	it('returns null rather than throwing, for a verified but irrelevant event type', () => {
		const event = normalizeStripeEvent({
			id: 'evt_other',
			object: 'event',
			type: 'payment_intent.succeeded',
			created: 1_800_000_000,
			data: { object: { id: 'pi_1' } }
		});
		expect(event).toBeNull();
	});
});

describe('normalizeStripeEvent - malformed top level', () => {
	it('throws on a payload missing id/type/created/data.object entirely', () => {
		expect(() => normalizeStripeEvent({ not: 'an event' })).toThrow(MalformedStripeEventError);
	});

	it('throws on a non-object payload', () => {
		expect(() => normalizeStripeEvent('not even json')).toThrow(MalformedStripeEventError);
		expect(() => normalizeStripeEvent(null)).toThrow(MalformedStripeEventError);
	});
});
