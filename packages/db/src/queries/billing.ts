// SPEC.md §15 and §8.1, issues #87, #88, #89. The write side of quota enforcement: what
// a user has, what a call spends it on, and the warm cache's own separate line. `billing.ts`
// (the schema) is the tables; this is the only place that writes to them, mirroring how
// `usage.ts` in @canonry/ai is the only place that writes `model_call`.
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { creditTransaction, userBilling } from '../schema/billing.js';
import { modelCall } from '../schema/model.js';
import type { ModelCallAgent, WarmArtifactKind } from '../schema/enums.js';

// SPEC.md §15: "never the word unlimited" - a stated ceiling every account has from the
// moment it exists. This is the number a brand new free account gets; it has nothing to
// do with what a paid plan grants later (that is #91's subscription issue), it only has
// to be real and finite so quota enforcement has something to check from request one.
export const FREE_PLAN_SUBSCRIPTION_CREDITS = 200;
export const FREE_PLAN_WARM_BUDGET_CREDITS = 50;

export interface Balance {
	userId: string;
	subscriptionCredits: number;
	purchasedCredits: number;
	/** subscriptionCredits + purchasedCredits: the interactive ceiling issue #88 checks
	 * before expensive work. Warm spend (issue #89) never touches this and this never
	 * touches warm - that separation is the entire point of #89. */
	totalCredits: number;
	warmBudgetCredits: number;
	warmBudgetSpent: number;
	warmBudgetRemaining: number;
	plan: string;
	periodEnd: Date | null;
}

function toBalance(row: typeof userBilling.$inferSelect): Balance {
	return {
		userId: row.userId,
		subscriptionCredits: row.subscriptionCredits,
		purchasedCredits: row.purchasedCredits,
		totalCredits: row.subscriptionCredits + row.purchasedCredits,
		warmBudgetCredits: row.warmBudgetCredits,
		warmBudgetSpent: row.warmBudgetSpent,
		warmBudgetRemaining: row.warmBudgetCredits - row.warmBudgetSpent,
		plan: row.plan,
		periodEnd: row.periodEnd
	};
}

/** Structural rather than `Db`, so a transaction handle (`tx` inside `db.transaction`)
 * satisfies it too - `Db` itself carries `$client` and `transaction`, which neither a
 * transaction handle has nor these helpers need. */
type Queryable = Pick<Db, 'select' | 'insert' | 'update'>;

/** Inserts the free-plan default row for a user who has none yet, or returns the row
 * that is already there. Shared by every function below that needs a `user_billing`
 * row to exist before it reads or writes one - ensureBilling, the free-credit path in
 * recordAndCharge, and the locked read in recordAndCharge/spendCredits/spendWarmBudget
 * all go through here, so "what a brand new account starts with" is defined in exactly
 * one place (SPEC.md §15's stated ceiling).
 *
 * `lock` adds `SELECT ... FOR UPDATE` to the fallback read, for a caller about to spend
 * against the row; skip it for a read-only caller (getBalance, the zero-credit path)
 * since a lock held to the end of the transaction for nothing serializes callers that
 * do not need to be. A row this call itself just inserted needs no separate lock - this
 * transaction is the only one that can see it until it commits. */
async function loadOrCreateBillingRow(
	tx: Queryable,
	userId: string,
	lock: boolean
): Promise<typeof userBilling.$inferSelect> {
	const [inserted] = await tx
		.insert(userBilling)
		.values({
			userId,
			subscriptionCredits: FREE_PLAN_SUBSCRIPTION_CREDITS,
			warmBudgetCredits: FREE_PLAN_WARM_BUDGET_CREDITS,
			plan: 'free'
		})
		.onConflictDoNothing({ target: userBilling.userId })
		.returning();
	if (inserted) return inserted;

	const query = tx.select().from(userBilling).where(eq(userBilling.userId, userId));
	const [existing] = await (lock ? query.for('update') : query).limit(1);
	if (!existing)
		throw new Error(`loadOrCreateBillingRow: no user_billing row for ${userId} after insert raced`);
	return existing;
}

/** True when a 'spend' credit_transaction already exists for `idempotencyKey` - the
 * retry-safety check shared by recordAndCharge, spendCredits and spendWarmBudget. */
async function hasSpentIdempotencyKey(tx: Queryable, idempotencyKey: string): Promise<boolean> {
	const existing = await tx
		.select()
		.from(creditTransaction)
		.where(
			and(eq(creditTransaction.kind, 'spend'), eq(creditTransaction.idempotencyKey, idempotencyKey))
		)
		.limit(1);
	return existing.length > 0;
}

/** Deducts `credits` from an already-locked balance row - subscription credits first,
 * then purchased (SPEC.md §15: purchased credits do not expire, so they are what a
 * user keeps if they stop paying, and spending them last is what makes that promise
 * mean anything on the day the subscription resets). Shared by recordAndCharge and
 * spendCredits, which differ only in what else lands in the same transaction. */
async function deductInteractiveBalance(
	tx: Queryable,
	locked: typeof userBilling.$inferSelect,
	credits: number
): Promise<typeof userBilling.$inferSelect> {
	const subscriptionSpend = Math.min(Math.max(locked.subscriptionCredits, 0), credits);
	const purchasedSpend = credits - subscriptionSpend;

	const [updated] = await tx
		.update(userBilling)
		.set({
			subscriptionCredits: locked.subscriptionCredits - subscriptionSpend,
			purchasedCredits: locked.purchasedCredits - purchasedSpend,
			updatedAt: new Date()
		})
		.where(eq(userBilling.userId, locked.userId))
		.returning();
	if (!updated) throw new Error('deductInteractiveBalance: user_billing update returned no row');
	return updated;
}

/** Creates the billing row a brand new account needs so quota enforcement has a real
 * ceiling from its first request (SPEC.md §15). Called from the Better Auth
 * `user.create.after` hook (apps/web/src/lib/server/auth.ts). Also the fallback
 * `getBalance` calls for a user who predates that hook or a test that never seeded one:
 * calling this twice is safe and never resets a balance that already moved. */
export async function ensureBilling(db: Db, userId: string): Promise<Balance> {
	return toBalance(await loadOrCreateBillingRow(db, userId, false));
}

/** The balance issue #88's "remaining balance is visible" reads from. Auto-creates a
 * free-plan row on first read rather than erroring - see ensureBilling. */
export async function getBalance(db: Db, userId: string): Promise<Balance> {
	return toBalance(await loadOrCreateBillingRow(db, userId, false));
}

export class InsufficientCreditsError extends Error {
	constructor(
		public readonly userId: string,
		public readonly required: number,
		public readonly available: number
	) {
		super(`user ${userId} has ${available} credits, needs ${required}`);
		this.name = 'InsufficientCreditsError';
	}
}

export class WarmBudgetExhaustedError extends Error {
	constructor(
		public readonly userId: string,
		public readonly required: number,
		public readonly available: number
	) {
		super(`warm budget for user ${userId} has ${available} credits remaining, needs ${required}`);
		this.name = 'WarmBudgetExhaustedError';
	}
}

/** Read-only preflight (issue #88: "quota is checked before expensive work"). Throws
 * InsufficientCreditsError, without writing anything, when the balance cannot cover
 * `credits` - called before the model call itself runs, so a request that cannot be
 * paid for never spends a token. `recordAndCharge`/`spendCredits` re-validate at write
 * time too, since the balance can move between this check and that write under
 * concurrent requests from the same account; see their doc comments for what happens
 * then. */
export async function previewCharge(db: Db, userId: string, credits: number): Promise<void> {
	if (credits <= 0) return;
	const balance = await getBalance(db, userId);
	if (balance.totalCredits < credits) {
		throw new InsufficientCreditsError(userId, credits, balance.totalCredits);
	}
}

export interface ChargeInput {
	// Nullable since migration 0014: model_call.user_id is now on delete set null,
	// nullable to begin with, for a system-attributed call (nightly warming,
	// universe-scoped indexing) that runs for a universe rather than for somebody.
	// A null userId means there is no balance to charge - see the function doc for
	// what that implies about `credits`.
	userId: string | null;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	provider: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	embeddingTokens: number;
	/** Already resolved (chargeFor) by the caller. Zero for a free/reading operation -
	 * recordAndCharge still writes the model_call row but spends nothing. Must be zero
	 * when userId is null: a chargeable operation with nobody to charge is a caller
	 * error, not a silent no-op. */
	credits: number;
	costEur: number;
	latencyMs: number;
	requestId: string | null;
	/** Retry safety (issue #88): a second call with the same key spends once. Omit only
	 * for a call with no realistic retry path (e.g. a background job with its own
	 * dedup). Ignored when credits is 0 - there is nothing to double-spend. */
	idempotencyKey?: string | null;
}

export interface ChargeResult {
	modelCallId: string;
	/** Null exactly when the call was recorded with no userId - there is no balance to
	 * report because there was nobody to charge. */
	balance: Balance | null;
	/** True when an existing credit_transaction for this idempotencyKey was found and
	 * reused instead of spending again - the retry case the acceptance criteria tests
	 * for. A fresh model_call row is still written either way (see the function doc). */
	alreadyCharged: boolean;
}

/** Issues #87 and #88's write side: records the model_call row and, when `credits` is
 * greater than zero, spends it from the user's balance in the same transaction, so the
 * two can never land separately. Idempotent on `idempotencyKey`: a retry that reuses
 * the key returns the transaction already on record (`alreadyCharged: true`) rather
 * than spending twice.
 *
 * A fresh model_call row is written on every call, retries included, even when the
 * charge itself is skipped as a duplicate: the retried attempt may have cost real
 * provider tokens again even though the user is only charged once, and SPEC.md §15's
 * margin question ("free to the user is not free to us") is answered from those rows
 * and nowhere else, so none of them may be dropped.
 *
 * For an agent with no model_call row to attach to (SPEC.md §6.7: import attributes
 * tokens to import_job, not model_call - deliberately absent from the model_call_agent
 * enum), use `spendCredits` instead; it does the same balance write without the
 * model_call insert.
 *
 * `userId: null` (migration 0014, a system-attributed call - nightly warming or
 * universe-scoped indexing run for a universe rather than for somebody) skips the
 * balance entirely: there is nobody to charge, so `credits` must be zero (a
 * chargeable operation with no payer throws rather than silently landing on nobody's
 * balance) and `balance` comes back null.
 *
 * Deliberately does not throw InsufficientCreditsError: previewCharge is the gate that
 * runs before the expensive work happens (issue #88), and by the time this function
 * runs that work is already done - the real cost already exists whether or not the
 * balance can currently cover it. Rolling back here would delete the one record of
 * that cost. Instead a race that drains the balance between the preflight and this
 * write is recorded honestly: purchasedCredits may go negative, which previewCharge's
 * next call reads and refuses immediately. */
export async function recordAndCharge(db: Db, input: ChargeInput): Promise<ChargeResult> {
	if (input.userId === null && input.credits > 0) {
		throw new Error('recordAndCharge: credits > 0 requires a userId to charge - nobody to bill');
	}

	return db.transaction(async (tx) => {
		const [call] = await tx
			.insert(modelCall)
			.values({
				userId: input.userId,
				universeId: input.universeId,
				agent: input.agent,
				operation: input.operation,
				provider: input.provider,
				modelId: input.modelId,
				inputTokens: input.inputTokens,
				outputTokens: input.outputTokens,
				embeddingTokens: input.embeddingTokens,
				credits: input.credits,
				costEur: input.costEur,
				latencyMs: input.latencyMs,
				requestId: input.requestId
			})
			.returning({ id: modelCall.id });
		if (!call) throw new Error('recordAndCharge: model_call insert returned no row');

		if (input.userId === null) {
			return { modelCallId: call.id, balance: null, alreadyCharged: false };
		}

		if (input.credits <= 0) {
			const balance = toBalance(await loadOrCreateBillingRow(tx, input.userId, false));
			return { modelCallId: call.id, balance, alreadyCharged: false };
		}

		if (input.idempotencyKey && (await hasSpentIdempotencyKey(tx, input.idempotencyKey))) {
			const balance = toBalance(await loadOrCreateBillingRow(tx, input.userId, false));
			return { modelCallId: call.id, balance, alreadyCharged: true };
		}

		const locked = await loadOrCreateBillingRow(tx, input.userId, true);
		const updated = await deductInteractiveBalance(tx, locked, input.credits);

		await tx.insert(creditTransaction).values({
			userId: input.userId,
			universeId: input.universeId,
			kind: 'spend',
			credits: -input.credits,
			operation: input.operation,
			modelCallId: call.id,
			idempotencyKey: input.idempotencyKey ?? null
		});

		return { modelCallId: call.id, balance: toBalance(updated), alreadyCharged: false };
	});
}

export interface SpendCreditsInput {
	userId: string;
	universeId: string | null;
	operation: string;
	credits: number;
	idempotencyKey?: string | null;
}

export interface SpendCreditsResult {
	balance: Balance;
	alreadyCharged: boolean;
}

/** The balance-only half of recordAndCharge, for a caller whose token/cost record
 * lives somewhere other than model_call - SPEC.md §6.7's import extraction attributes
 * its tokens to import_job (already tracked there), so charging it through
 * recordAndCharge would mean inventing a model_call row with no real call behind it.
 * Same subscription-then-purchased order and idempotency-key retry safety as
 * recordAndCharge; the only difference is that nothing else is written in the same
 * transaction. Also does not throw InsufficientCreditsError, for the same reason
 * recordAndCharge does not - see its doc comment. */
export async function spendCredits(db: Db, input: SpendCreditsInput): Promise<SpendCreditsResult> {
	if (input.credits <= 0) {
		return { balance: await getBalance(db, input.userId), alreadyCharged: false };
	}

	return db.transaction(async (tx) => {
		if (input.idempotencyKey && (await hasSpentIdempotencyKey(tx, input.idempotencyKey))) {
			return {
				balance: toBalance(await loadOrCreateBillingRow(tx, input.userId, false)),
				alreadyCharged: true
			};
		}

		const locked = await loadOrCreateBillingRow(tx, input.userId, true);
		const updated = await deductInteractiveBalance(tx, locked, input.credits);

		await tx.insert(creditTransaction).values({
			userId: input.userId,
			universeId: input.universeId,
			kind: 'spend',
			credits: -input.credits,
			operation: input.operation,
			modelCallId: null,
			idempotencyKey: input.idempotencyKey ?? null
		});

		return { balance: toBalance(updated), alreadyCharged: false };
	});
}

export interface WarmSpendInput {
	userId: string;
	universeId: string | null;
	kind: WarmArtifactKind;
	credits: number;
	modelCallId?: string | null;
	idempotencyKey?: string | null;
}

/** Issue #89's write side: spends against the warm line (`user_billing.warm_budget_spent`)
 * only, never against subscription or purchased credits - the two budgets never touch
 * each other, which is the entire point of a separate line (SPEC.md §8.1: "an invisible
 * spend is how a quota loses its meaning"). Idempotent on `idempotencyKey`, same as
 * `recordAndCharge`.
 *
 * Enforces the hard ceiling - `warm_budget_spent` may never exceed `warm_budget_credits`
 * - by throwing WarmBudgetExhaustedError and rolling back. That is safe to do here,
 * unlike in recordAndCharge: warm generation's own cost record lives on the
 * `warm_artifact` row the caller writes separately, not inside this transaction, so
 * nothing is lost by refusing the spend. The softer, tier-based degradation order
 * (media first, then drafts, text last) is a decision the caller makes before
 * generating anything at all, via `warmTierOf`/`warmSpendAllowed` in @canonry/ai; this
 * function only ever performs a spend the caller already decided to make, and this
 * throw is the backstop for when that decision turns out to have been made against a
 * stale balance. */
export async function spendWarmBudget(db: Db, input: WarmSpendInput): Promise<Balance> {
	if (input.credits <= 0) return getBalance(db, input.userId);

	return db.transaction(async (tx) => {
		if (input.idempotencyKey && (await hasSpentIdempotencyKey(tx, input.idempotencyKey))) {
			return toBalance(await loadOrCreateBillingRow(tx, input.userId, false));
		}

		const locked = await loadOrCreateBillingRow(tx, input.userId, true);

		const remaining = locked.warmBudgetCredits - locked.warmBudgetSpent;
		if (remaining < input.credits) {
			throw new WarmBudgetExhaustedError(input.userId, input.credits, remaining);
		}

		const [updated] = await tx
			.update(userBilling)
			.set({
				warmBudgetSpent: sql`${userBilling.warmBudgetSpent} + ${input.credits}`,
				updatedAt: new Date()
			})
			.where(eq(userBilling.userId, input.userId))
			.returning();
		if (!updated) throw new Error('spendWarmBudget: user_billing update returned no row');

		await tx.insert(creditTransaction).values({
			userId: input.userId,
			universeId: input.universeId,
			kind: 'spend',
			credits: -input.credits,
			operation: `warm:${input.kind}`,
			modelCallId: input.modelCallId ?? null,
			idempotencyKey: input.idempotencyKey ?? null
		});

		return toBalance(updated);
	});
}
