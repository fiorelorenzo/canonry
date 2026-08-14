/**
 * SPEC.md §15, issue #91's acceptance criteria: "test the webhook handler against
 * replayed and out-of-order events with a fake provider, since that is where real money
 * goes wrong and it is testable without a key." No Stripe account touches this file -
 * every event here is a plain object this suite constructs itself, which is exactly the
 * point of `SubscriptionWebhookEvent` being provider-agnostic.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	applySubscriptionWebhookEvent,
	closeDb,
	FREE_PLAN_SUBSCRIPTION_CREDITS,
	FREE_PLAN_WARM_BUDGET_CREDITS,
	getBalance,
	getSubscriptionPlan,
	spendCredits,
	SUBSCRIPTION_PLANS,
	UnknownSubscriptionPlanError,
	type Db,
	type SubscriptionWebhookEvent
} from '../src/index.js';
import { creditTransaction, userBilling } from '../src/schema/billing.js';
import { insertUser, testDb, unique } from './helpers.js';

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
		periodStart: new Date('2026-01-01T00:00:00Z'),
		periodEnd: new Date('2026-02-01T00:00:00Z'),
		...overrides
	};
}

describe('SUBSCRIPTION_PLANS', () => {
	it('every plan states a real, finite ceiling - SPEC.md §15 forbids the word "unlimited"', () => {
		expect(SUBSCRIPTION_PLANS.length).toBeGreaterThan(0);
		for (const plan of SUBSCRIPTION_PLANS) {
			expect(plan.ceiling.toLowerCase()).not.toContain('unlimited');
			expect(plan.subscriptionCreditsPerPeriod).toBeGreaterThan(0);
			expect(Number.isFinite(plan.subscriptionCreditsPerPeriod)).toBe(true);
		}
	});

	it('the free plan matches the ceiling every brand new account already gets from ensureBilling', () => {
		const free = getSubscriptionPlan('free');
		expect(free?.subscriptionCreditsPerPeriod).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS);
		expect(free?.warmBudgetCreditsPerPeriod).toBe(FREE_PLAN_WARM_BUDGET_CREDITS);
	});

	it('getSubscriptionPlan returns undefined for an id nothing sells', () => {
		expect(getSubscriptionPlan('gold-tier-nonsense')).toBeUndefined();
	});
});

describe('applySubscriptionWebhookEvent', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('refuses to grant an unstated ceiling for an unknown plan', async () => {
		const owner = await insertUser(db);
		await expect(
			applySubscriptionWebhookEvent(db, invoicePaid({ userId: owner.id, planId: 'gold-tier' }))
		).rejects.toBeInstanceOf(UnknownSubscriptionPlanError);
	});

	it('grants the plan ceiling and records plan/period on a fresh event', async () => {
		const owner = await insertUser(db);
		const event = invoicePaid({ userId: owner.id });

		const result = await applySubscriptionWebhookEvent(db, event);

		expect(result).toMatchObject({ applied: true, alreadyProcessed: false, stale: false });
		expect(result.balance.plan).toBe('plus');
		expect(result.balance.subscriptionCredits).toBe(5000);
		expect(result.balance.warmBudgetCredits).toBe(600);

		const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, owner.id));
		expect(row?.periodStart.toISOString()).toBe(
			event.type === 'invoice.paid' ? event.periodStart.toISOString() : ''
		);

		const [txn] = await db
			.select()
			.from(creditTransaction)
			.where(
				and(eq(creditTransaction.kind, 'grant'), eq(creditTransaction.idempotencyKey, event.id))
			);
		expect(txn?.credits).toBe(5000);
	});

	it('a replayed event (same id) grants exactly once', async () => {
		const owner = await insertUser(db);
		const event = invoicePaid({ userId: owner.id });

		const first = await applySubscriptionWebhookEvent(db, event);
		const second = await applySubscriptionWebhookEvent(db, event);

		expect(first.alreadyProcessed).toBe(false);
		expect(second.alreadyProcessed).toBe(true);
		expect(second.balance.subscriptionCredits).toBe(first.balance.subscriptionCredits);

		const grants = await db
			.select()
			.from(creditTransaction)
			.where(
				and(eq(creditTransaction.kind, 'grant'), eq(creditTransaction.idempotencyKey, event.id))
			);
		expect(grants).toHaveLength(1);
	});

	it('expires unspent credits from the old period instead of stacking them onto the new grant', async () => {
		const owner = await insertUser(db);
		const firstPeriod = invoicePaid({
			userId: owner.id,
			periodStart: new Date('2026-01-01T00:00:00Z'),
			periodEnd: new Date('2026-02-01T00:00:00Z')
		});
		await applySubscriptionWebhookEvent(db, firstPeriod);

		// Spend 1,200 of the first period's 5,000 credits, leaving 3,800 unspent.
		await spendCredits(db, {
			userId: owner.id,
			universeId: null,
			operation: unique('subscription-test-spend'),
			credits: 1200
		});
		const midway = await getBalance(db, owner.id);
		expect(midway.subscriptionCredits).toBe(3800);

		const secondPeriod = invoicePaid({
			userId: owner.id,
			periodStart: new Date('2026-02-01T00:00:00Z'),
			periodEnd: new Date('2026-03-01T00:00:00Z')
		});
		const result = await applySubscriptionWebhookEvent(db, secondPeriod);

		// The new period grants a fresh 5,000 - the 3,800 left over from January does not
		// carry forward (SPEC.md §15: "the subscription's monthly allowance... expires
		// with the period"), so the balance is exactly the stated ceiling, not 8,800.
		expect(result.balance.subscriptionCredits).toBe(5000);

		// Two expiry rows exist for this user by now: the free plan's 200 credits expired
		// when firstPeriod upgraded the account away from 'free', and January's leftover
		// 3,800 expired here. Only the second is this assertion's concern.
		const expiry = await db
			.select()
			.from(creditTransaction)
			.where(and(eq(creditTransaction.kind, 'expiry'), eq(creditTransaction.userId, owner.id)));
		expect(expiry).toHaveLength(2);
		expect(expiry.map((row) => row.credits).sort((a, b) => a - b)).toEqual([-3800, -200]);
	});

	it('an out-of-order event for an already-superseded period is ignored, not rolled back', async () => {
		const owner = await insertUser(db);
		const newerPeriod = invoicePaid({
			userId: owner.id,
			periodStart: new Date('2026-03-01T00:00:00Z'),
			periodEnd: new Date('2026-04-01T00:00:00Z')
		});
		await applySubscriptionWebhookEvent(db, newerPeriod);

		// A different event id, but describing a period that started before the one
		// already applied - the late-arriving delivery of an earlier renewal.
		const staleEvent = invoicePaid({
			userId: owner.id,
			periodStart: new Date('2026-02-01T00:00:00Z'),
			periodEnd: new Date('2026-03-01T00:00:00Z')
		});
		const result = await applySubscriptionWebhookEvent(db, staleEvent);

		expect(result.stale).toBe(true);
		expect(result.applied).toBe(false);

		const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, owner.id));
		// The March period stands - the stale February event never touched it.
		expect(row?.periodStart.toISOString()).toBe(
			newerPeriod.type === 'invoice.paid' ? newerPeriod.periodStart.toISOString() : ''
		);
		expect(row?.subscriptionCredits).toBe(5000);

		// A replay of the exact same stale event is still caught by idempotency, not
		// re-evaluated as a fresh out-of-order case every time.
		const replay = await applySubscriptionWebhookEvent(db, staleEvent);
		expect(replay.alreadyProcessed).toBe(true);
		expect(replay.stale).toBe(false);
	});

	it('customer.subscription.deleted reverts the plan to free without touching the balance', async () => {
		const owner = await insertUser(db);
		await applySubscriptionWebhookEvent(db, invoicePaid({ userId: owner.id }));
		const before = await getBalance(db, owner.id);

		const result = await applySubscriptionWebhookEvent(db, {
			id: unique('evt'),
			type: 'customer.subscription.deleted',
			occurredAt: new Date(),
			userId: owner.id
		});

		expect(result.balance.plan).toBe('free');
		expect(result.balance.subscriptionCredits).toBe(before.subscriptionCredits);
	});

	it('two different real ids race for the same user - the lock serializes them so credits never grant twice', async () => {
		const owner = await insertUser(db);
		const eventA = invoicePaid({ userId: owner.id, id: randomUUID() });
		const eventB = invoicePaid({ userId: owner.id, id: randomUUID() });

		await Promise.all([
			applySubscriptionWebhookEvent(db, eventA),
			applySubscriptionWebhookEvent(db, eventB)
		]);

		const balance = await getBalance(db, owner.id);
		// Both events describe the same period at the same ceiling, so either order is a
		// legitimate double-delivery of "renew to 5,000" - the assertion that matters is
		// that granting is not additive: two grants for one period still land on 5,000,
		// never 10,000.
		expect(balance.subscriptionCredits).toBe(5000);

		const grants = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.kind, 'grant'));
		const forThisUser = grants.filter((row) => row.userId === owner.id);
		expect(forThisUser).toHaveLength(2);
		const total = forThisUser.reduce((sum, row) => sum + row.credits, 0);
		expect(total).toBe(5000);
	});
});
