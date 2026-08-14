/**
 * Issue #91's acceptance criteria: "test the webhook handler against replayed and
 * out-of-order events with a fake provider, since that is where real money goes wrong
 * and it is testable without a key." `FakePaymentProvider` below stands in for
 * `StripeProvider` (provider.ts) - `receiveWebhook` (subscription.ts) never knows the
 * difference, and no signature, no network call and no Stripe account are involved
 * anywhere in this file. Runs against the real dev Postgres, same as export.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db, type SubscriptionWebhookEvent } from '@canonry/db';
import { creditTransaction, user, userBilling } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentProvider } from './provider.js';
import { receiveWebhook } from './subscription.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Returns a canned, pre-normalized event regardless of what `rawBody`/`signatureHeader`
 * it is called with - the whole point of testing against the provider seam rather than a
 * real signed Stripe payload. `queue` is consumed in order, one event per call, so a test
 * can drive replayed or out-of-order deliveries by queuing the same or reordered events. */
class FakePaymentProvider implements PaymentProvider {
	private readonly queue: (SubscriptionWebhookEvent | null)[];

	constructor(events: (SubscriptionWebhookEvent | null)[]) {
		this.queue = [...events];
	}

	createCheckoutSession(): Promise<never> {
		throw new Error(
			'FakePaymentProvider: createCheckoutSession is not exercised by webhook.test.ts'
		);
	}

	parseWebhookEvent(): SubscriptionWebhookEvent | null {
		const next = this.queue.shift();
		if (next === undefined) throw new Error('FakePaymentProvider: queue exhausted');
		return next;
	}
}

function invoicePaid(
	overrides: Partial<Extract<SubscriptionWebhookEvent, { type: 'invoice.paid' }>> & {
		userId: string;
	}
): SubscriptionWebhookEvent {
	return {
		id: unique('evt'),
		type: 'invoice.paid',
		occurredAt: new Date(),
		planId: 'plus',
		periodStart: new Date('2026-04-01T00:00:00Z'),
		periodEnd: new Date('2026-05-01T00:00:00Z'),
		...overrides
	};
}

describe('receiveWebhook against a fake provider', () => {
	let db: Db;
	let userId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 2 });
		userId = unique('webhook-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Webhook Test User', email: `${userId}@example.test` });
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	it('grants credits on a fresh event and reports handled: true', async () => {
		const event = invoicePaid({ userId });
		const outcome = await receiveWebhook(
			'irrelevant-body',
			'irrelevant-sig',
			new FakePaymentProvider([event])
		);

		expect(outcome.handled).toBe(true);
		expect(outcome.result?.applied).toBe(true);

		const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, userId));
		expect(row?.subscriptionCredits).toBe(5000);
	});

	it('an unrelated event type reports handled: false and touches nothing', async () => {
		const outcome = await receiveWebhook('body', 'sig', new FakePaymentProvider([null]));
		expect(outcome).toEqual({ handled: false });
	});

	it('replaying the exact same event twice grants credits exactly once - proof for #91', async () => {
		const freshUser = unique('webhook-replay-user');
		await db
			.insert(user)
			.values({ id: freshUser, name: 'Replay User', email: `${freshUser}@example.test` });
		try {
			const event = invoicePaid({ userId: freshUser });
			const provider = new FakePaymentProvider([event, event]);

			const first = await receiveWebhook('body', 'sig', provider);
			const second = await receiveWebhook('body', 'sig', provider);

			expect(first.result?.alreadyProcessed).toBe(false);
			expect(second.result?.alreadyProcessed).toBe(true);

			const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, freshUser));
			expect(row?.subscriptionCredits).toBe(5000);

			const grants = await db
				.select()
				.from(creditTransaction)
				.where(eq(creditTransaction.userId, freshUser));
			const realGrants = grants.filter((txn) => txn.kind === 'grant' && txn.credits > 0);
			expect(realGrants).toHaveLength(1);
		} finally {
			await db.delete(user).where(eq(user.id, freshUser));
		}
	});

	it('an out-of-order delivery (older period, later arrival) is ignored, not rolled back', async () => {
		const freshUser = unique('webhook-order-user');
		await db
			.insert(user)
			.values({ id: freshUser, name: 'Order User', email: `${freshUser}@example.test` });
		try {
			const newer = invoicePaid({
				userId: freshUser,
				periodStart: new Date('2026-06-01T00:00:00Z'),
				periodEnd: new Date('2026-07-01T00:00:00Z')
			});
			const stale = invoicePaid({
				userId: freshUser,
				periodStart: new Date('2026-05-01T00:00:00Z'),
				periodEnd: new Date('2026-06-01T00:00:00Z')
			});
			const provider = new FakePaymentProvider([newer, stale]);

			await receiveWebhook('body', 'sig', provider);
			const secondOutcome = await receiveWebhook('body', 'sig', provider);

			expect(secondOutcome.result?.stale).toBe(true);

			const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, freshUser));
			expect(row?.periodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z');
			expect(row?.subscriptionCredits).toBe(5000);
		} finally {
			await db.delete(user).where(eq(user.id, freshUser));
		}
	});
});
