/**
 * SPEC.md §15, issue #91: the subscription side of billing. `billing.ts` owns the
 * balance primitives (recordAndCharge, spendCredits, spendWarmBudget) - every one of
 * them moves a fixed amount. A subscription renewal is a different shape of write: it
 * resets a ceiling for a new period, and it has to survive a payment provider's webhook
 * arriving twice, or arriving out of order, without granting credits twice or letting a
 * stale delivery roll back a newer period. That is what this file is for.
 *
 * No Stripe types or HTTP concerns live here, on purpose - the same driver-boundary rule
 * `AGENTS.md` states for packages/import applies just as much to a payment provider as to
 * a model provider. `SubscriptionWebhookEvent` is a normalized shape apps/web's own
 * provider adapter (`$lib/server/billing/provider.ts`) builds from a real Stripe event
 * after verifying its signature, so this function and its tests never need to know what
 * Stripe's webhook payload looks like, and are runnable with no Stripe account at all.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { creditTransaction, userBilling } from '../schema/billing.js';
import {
	ensureBilling,
	FREE_PLAN_SUBSCRIPTION_CREDITS,
	FREE_PLAN_WARM_BUDGET_CREDITS,
	toBalance,
	type Balance
} from './billing.js';

/** Structural rather than `Db` - see billing.ts's own `Queryable` for why: a transaction
 * handle satisfies this but not the full `Db` type. */
type Queryable = Pick<Db, 'select' | 'insert' | 'update'>;

// SPEC.md §15: "no opaque credits... never the word unlimited" - every plan states a
// real, finite ceiling in its own copy, not just in the numbers a settings page renders
// next to it. Credits are priced at the same 1 credit = EUR 0.01 default @canonry/ai's
// usage.ts uses (DEFAULT_CREDITS_PER_EUR); the two paid tiers' numbers match the ones
// already shown in docs/ux/f2-quota-and-cost.html's mock (2,400 / 5,000 credits, 180 / 600
// warm budget) so the settings page this file feeds does not tell a different story than
// the decision that shaped it. The free plan reuses billing.ts's own constants rather
// than restating them, so the two can never drift apart.
export interface SubscriptionPlan {
	id: string;
	name: string;
	priceEurPerMonth: number;
	subscriptionCreditsPerPeriod: number;
	warmBudgetCreditsPerPeriod: number;
	/** One sentence, safe to render verbatim next to the plan on the settings page:
	 * states the ceiling in real numbers, never claims "unlimited" (SPEC.md §15). */
	ceiling: string;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
	{
		id: 'free',
		name: 'Free',
		priceEurPerMonth: 0,
		subscriptionCreditsPerPeriod: FREE_PLAN_SUBSCRIPTION_CREDITS,
		warmBudgetCreditsPerPeriod: FREE_PLAN_WARM_BUDGET_CREDITS,
		ceiling: `${FREE_PLAN_SUBSCRIPTION_CREDITS} credits included every month, ${FREE_PLAN_WARM_BUDGET_CREDITS} of them reserved for background warming. Reading, search and Ask's retrieval are always free and never touch this.`
	},
	{
		id: 'plus',
		name: 'Plus',
		priceEurPerMonth: 9,
		subscriptionCreditsPerPeriod: 5000,
		warmBudgetCreditsPerPeriod: 600,
		ceiling:
			'5,000 credits included every period, 600 of them reserved for background warming. Generation stops when they run out until the next period, a purchased top-up, or your own key - it never quietly keeps going.'
	},
	{
		id: 'pro',
		name: 'Pro',
		priceEurPerMonth: 29,
		subscriptionCreditsPerPeriod: 20000,
		warmBudgetCreditsPerPeriod: 2400,
		ceiling:
			'20,000 credits included every period, 2,400 of them reserved for background warming. Generation stops when they run out until the next period, a purchased top-up, or your own key - it never quietly keeps going.'
	}
] as const;

export function getSubscriptionPlan(id: string): SubscriptionPlan | undefined {
	return SUBSCRIPTION_PLANS.find((plan) => plan.id === id);
}

export class UnknownSubscriptionPlanError extends Error {
	constructor(planId: string) {
		super(`no subscription plan named "${planId}" - refusing to grant an unstated ceiling`);
		this.name = 'UnknownSubscriptionPlanError';
	}
}

/** Normalized webhook events this file understands. apps/web's provider adapter builds
 * one of these from a verified Stripe event before calling applySubscriptionWebhookEvent -
 * every other Stripe event type is accepted and ignored at that boundary, not here. */
export type SubscriptionWebhookEvent =
	| {
			id: string;
			type: 'invoice.paid';
			occurredAt: Date;
			userId: string;
			planId: string;
			periodStart: Date;
			periodEnd: Date;
	  }
	| {
			id: string;
			type: 'customer.subscription.deleted';
			occurredAt: Date;
			userId: string;
	  };

export interface ApplyWebhookEventResult {
	/** True only when this call actually moved the balance or changed the plan. */
	applied: boolean;
	/** True when this exact event id was already applied - a provider retry, replayed on
	 * purpose or by accident, changes nothing the second time (SPEC.md §15's margin
	 * question still gets a row - see the note this writes - but the balance does not
	 * move twice). */
	alreadyProcessed: boolean;
	/** True when this event's own id is new but the period it describes is older than one
	 * already applied - two webhook deliveries that arrived out of order. The event is
	 * still recorded under its own id (so a later replay of *this* id is caught by
	 * alreadyProcessed too) but the balance is left exactly as the newer period set it. */
	stale: boolean;
	balance: Balance;
}

/** Mirrors billing.ts's own `hasSpentIdempotencyKey`, scoped to 'grant' instead of
 * 'spend' - a subscription renewal and an interactive spend never share an idempotency
 * namespace even if a caller reused the same string by accident, because the unique
 * index this checks against is itself scoped by (kind, idempotency_key). */
async function hasGrantedIdempotencyKey(tx: Queryable, idempotencyKey: string): Promise<boolean> {
	const existing = await tx
		.select()
		.from(creditTransaction)
		.where(
			and(eq(creditTransaction.kind, 'grant'), eq(creditTransaction.idempotencyKey, idempotencyKey))
		)
		.limit(1);
	return existing.length > 0;
}

async function applyInvoicePaid(
	db: Db,
	event: Extract<SubscriptionWebhookEvent, { type: 'invoice.paid' }>
): Promise<ApplyWebhookEventResult> {
	const plan = getSubscriptionPlan(event.planId);
	if (!plan) throw new UnknownSubscriptionPlanError(event.planId);

	// Guarantees a row exists before the transaction below locks it - ensureBilling is
	// itself idempotent, so calling it ahead of a transaction that might turn out to be a
	// pure replay costs one extra read on the common path, never a wrong result.
	await ensureBilling(db, event.userId);

	return db.transaction(async (tx) => {
		if (await hasGrantedIdempotencyKey(tx, event.id)) {
			const [row] = await tx
				.select()
				.from(userBilling)
				.where(eq(userBilling.userId, event.userId))
				.limit(1);
			if (!row) throw new Error('applySubscriptionWebhookEvent: missing user_billing row');
			return { applied: false, alreadyProcessed: true, stale: false, balance: toBalance(row) };
		}

		const [locked] = await tx
			.select()
			.from(userBilling)
			.where(eq(userBilling.userId, event.userId))
			.for('update')
			.limit(1);
		if (!locked) throw new Error('applySubscriptionWebhookEvent: missing user_billing row');

		// Out-of-order guard: a period no newer than the one already on record is a stale
		// delivery (a retry queue, a webhook relay, two deliveries racing a network hiccup,
		// or a second event id for a period already granted) rather than a legitimate
		// renewal - `<=` rather than `<` so two different event ids describing the exact
		// same period never grant twice either. Skipped entirely while the account is still
		// on 'free': ensureBilling stamps a brand new row's periodStart with "now" (account
		// creation time), which is not a real billing period to protect - the very first
		// invoice.paid a user ever gets always applies. Still recorded under its own event
		// id, so a second delivery of *this exact* stale event is caught by
		// alreadyProcessed above on its next replay rather than re-evaluated every time.
		if (locked.plan !== 'free' && event.periodStart.getTime() <= locked.periodStart.getTime()) {
			await tx.insert(creditTransaction).values({
				userId: event.userId,
				universeId: null,
				kind: 'grant',
				credits: 0,
				operation: 'subscription.renew',
				idempotencyKey: event.id,
				note:
					`out-of-order invoice.paid for the period starting ${event.periodStart.toISOString()}, ` +
					`ignored because a period starting ${locked.periodStart.toISOString()} is already applied`
			});
			return { applied: false, alreadyProcessed: false, stale: true, balance: toBalance(locked) };
		}

		// SPEC.md §15 / docs/ux F2: "the subscription's monthly allowance is spent first
		// and expires with the period." Unspent subscription credits from the period being
		// replaced do not roll over - they expire in the same transaction the new period's
		// credits are granted in, so `sum(credit_transaction.credits)` for this user always
		// still equals the balance the row ends up holding (creditTransaction's own "the
		// balance is the sum" comment in billing.ts's schema file).
		const expiring = Math.max(locked.subscriptionCredits, 0);

		const [updated] = await tx
			.update(userBilling)
			.set({
				plan: plan.id,
				periodStart: event.periodStart,
				periodEnd: event.periodEnd,
				subscriptionCredits: plan.subscriptionCreditsPerPeriod,
				warmBudgetCredits: plan.warmBudgetCreditsPerPeriod,
				warmBudgetSpent: 0,
				updatedAt: new Date()
			})
			.where(eq(userBilling.userId, event.userId))
			.returning();
		if (!updated) {
			throw new Error('applySubscriptionWebhookEvent: user_billing update returned no row');
		}

		const rows: (typeof creditTransaction.$inferInsert)[] = [];
		if (expiring > 0) {
			rows.push({
				userId: event.userId,
				universeId: null,
				kind: 'expiry',
				credits: -expiring,
				operation: 'subscription.renew',
				note: `unspent credits from the period ending ${locked.periodEnd?.toISOString() ?? 'unset'} expired at renewal`
			});
		}
		rows.push({
			userId: event.userId,
			universeId: null,
			kind: 'grant',
			credits: plan.subscriptionCreditsPerPeriod,
			operation: 'subscription.renew',
			idempotencyKey: event.id,
			note: `${plan.name} plan renewed for the period starting ${event.periodStart.toISOString()}`
		});
		await tx.insert(creditTransaction).values(rows);

		return { applied: true, alreadyProcessed: false, stale: false, balance: toBalance(updated) };
	});
}

/** No credits move on a cancellation - whatever was already granted for the current
 * period stays spendable until it naturally expires at the next renewal (or never, if
 * there is none). Naturally idempotent (setting the same plan twice is a no-op) so this
 * needs no idempotency key of its own, unlike the grant path above. */
async function applySubscriptionDeleted(
	db: Db,
	event: Extract<SubscriptionWebhookEvent, { type: 'customer.subscription.deleted' }>
): Promise<ApplyWebhookEventResult> {
	await ensureBilling(db, event.userId);
	const [updated] = await db
		.update(userBilling)
		.set({ plan: 'free', updatedAt: new Date() })
		.where(eq(userBilling.userId, event.userId))
		.returning();
	if (!updated)
		throw new Error('applySubscriptionWebhookEvent: user_billing update returned no row');
	return { applied: true, alreadyProcessed: false, stale: false, balance: toBalance(updated) };
}

/** The webhook handler's write side (issue #91's acceptance criteria: "grants credits
 * idempotently on credit_transaction's idempotency key... replayed and out-of-order
 * events"). apps/web's webhook route verifies the provider's signature and normalizes
 * the raw event into `SubscriptionWebhookEvent` before calling this - everything below
 * this line is provider-agnostic and runs against a fake provider's events in tests just
 * as well as a real Stripe one. */
export async function applySubscriptionWebhookEvent(
	db: Db,
	event: SubscriptionWebhookEvent
): Promise<ApplyWebhookEventResult> {
	switch (event.type) {
		case 'invoice.paid':
			return applyInvoicePaid(db, event);
		case 'customer.subscription.deleted':
			return applySubscriptionDeleted(db, event);
	}
}
