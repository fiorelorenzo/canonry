import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type ChargeInput,
	closeDb,
	type Db,
	ensureBilling,
	FREE_PLAN_SUBSCRIPTION_CREDITS,
	FREE_PLAN_WARM_BUDGET_CREDITS,
	getBalance,
	InsufficientCreditsError,
	previewCharge,
	recordAndCharge,
	spendCredits,
	spendWarmBudget,
	WarmBudgetExhaustedError
} from '../src/index.js';
import { creditTransaction, userBilling } from '../src/schema/billing.js';
import { modelCall } from '../src/schema/model.js';
import { insertUser, testDb, unique } from './helpers.js';

function callInput(
	userId: string | null,
	credits: number,
	overrides: Partial<ChargeInput> = {}
): ChargeInput {
	return {
		userId,
		universeId: null,
		agent: 'loremaster',
		operation: unique('billing-test-op'),
		provider: 'test-provider',
		modelId: 'test-model',
		inputTokens: 100,
		outputTokens: 40,
		embeddingTokens: 0,
		credits,
		costEur: 0.02,
		latencyMs: 250,
		requestId: null,
		...overrides
	};
}

describe('ensureBilling and getBalance', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('gives a new account a stated, finite ceiling - never "unlimited" (SPEC.md §15)', async () => {
		const owner = await insertUser(db);
		const balance = await getBalance(db, owner.id);
		expect(balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS);
		expect(balance.purchasedCredits).toBe(0);
		expect(balance.totalCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS);
		expect(balance.warmBudgetCredits).toBe(FREE_PLAN_WARM_BUDGET_CREDITS);
		expect(balance.warmBudgetSpent).toBe(0);
		expect(balance.warmBudgetRemaining).toBe(FREE_PLAN_WARM_BUDGET_CREDITS);
		expect(balance.plan).toBe('free');
	});

	it('is idempotent - calling it again never resets a balance that already moved', async () => {
		const owner = await insertUser(db);
		await ensureBilling(db, owner.id);
		await recordAndCharge(db, callInput(owner.id, 10));
		await ensureBilling(db, owner.id);
		const balance = await getBalance(db, owner.id);
		expect(balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS - 10);
	});
});

describe('previewCharge', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('refuses a charge that exceeds the balance, before anything runs', async () => {
		const owner = await insertUser(db);
		await expect(previewCharge(db, owner.id, FREE_PLAN_SUBSCRIPTION_CREDITS + 1)).rejects.toThrow(
			InsufficientCreditsError
		);
	});

	it('allows a charge within the balance', async () => {
		const owner = await insertUser(db);
		await expect(
			previewCharge(db, owner.id, FREE_PLAN_SUBSCRIPTION_CREDITS)
		).resolves.toBeUndefined();
	});

	it('never checks the balance for a free (zero-credit) call - reading is never blocked', async () => {
		const owner = await insertUser(db);
		await db
			.update(userBilling)
			.set({ subscriptionCredits: 0, purchasedCredits: 0 })
			.where(eq(userBilling.userId, owner.id));
		await expect(previewCharge(db, owner.id, 0)).resolves.toBeUndefined();
	});
});

describe('recordAndCharge', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('a free operation records the call but never moves the balance - a search does not move the meter (SPEC.md §15)', async () => {
		const owner = await insertUser(db);
		const before = await getBalance(db, owner.id);

		const { modelCallId, balance, alreadyCharged } = await recordAndCharge(
			db,
			callInput(owner.id, 0, { operation: 'search.semantic' })
		);

		expect(alreadyCharged).toBe(false);
		expect(balance.subscriptionCredits).toBe(before.subscriptionCredits);
		expect(balance.purchasedCredits).toBe(before.purchasedCredits);
		expect(balance.totalCredits).toBe(before.totalCredits);

		const [call] = await db.select().from(modelCall).where(eq(modelCall.id, modelCallId));
		expect(call?.credits).toBe(0);
		expect(call?.operation).toBe('search.semantic');

		const transactions = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.modelCallId, modelCallId));
		expect(transactions).toHaveLength(0);
	});

	it('a charged operation decrements the balance and records exactly one spend transaction', async () => {
		const owner = await insertUser(db);
		const { modelCallId, balance } = await recordAndCharge(db, callInput(owner.id, 15));

		expect(balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS - 15);

		const [txn] = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.modelCallId, modelCallId));
		expect(txn?.kind).toBe('spend');
		expect(txn?.credits).toBe(-15);
	});

	it('spends subscription credits before purchased ones (SPEC.md §15)', async () => {
		const owner = await insertUser(db);
		await ensureBilling(db, owner.id);
		await db
			.update(userBilling)
			.set({ subscriptionCredits: 5, purchasedCredits: 100 })
			.where(eq(userBilling.userId, owner.id));

		const { balance } = await recordAndCharge(db, callInput(owner.id, 20));

		expect(balance.subscriptionCredits).toBe(0);
		expect(balance.purchasedCredits).toBe(85);
	});

	it('a retry with the same idempotency key decrements the balance exactly once', async () => {
		const owner = await insertUser(db);
		const key = unique('idempotency-key');
		const operation = unique('retry-op');

		const first = await recordAndCharge(
			db,
			callInput(owner.id, 10, { idempotencyKey: key, operation })
		);
		const second = await recordAndCharge(
			db,
			callInput(owner.id, 10, { idempotencyKey: key, operation })
		);

		expect(first.alreadyCharged).toBe(false);
		expect(second.alreadyCharged).toBe(true);
		expect(second.balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS - 10);
		expect(second.balance.subscriptionCredits).toBe(first.balance.subscriptionCredits);

		// Both attempts are still recorded (issue #87: every call, retries included -
		// the retried request may have cost real provider tokens again even though the
		// user is only charged once).
		const calls = await db.select().from(modelCall).where(eq(modelCall.operation, operation));
		expect(calls).toHaveLength(2);

		const spends = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.idempotencyKey, key));
		expect(spends).toHaveLength(1);
	});

	it('a system-attributed call (userId null, migration 0014) records but has no balance to move', async () => {
		const { modelCallId, balance, alreadyCharged } = await recordAndCharge(
			db,
			callInput(null, 0, { operation: 'index.embed' })
		);

		expect(alreadyCharged).toBe(false);
		expect(balance).toBeNull();

		const [call] = await db.select().from(modelCall).where(eq(modelCall.id, modelCallId));
		expect(call?.userId).toBeNull();
	});

	it('refuses to charge credits with no userId to bill', async () => {
		await expect(recordAndCharge(db, callInput(null, 5))).rejects.toThrow('nobody to bill');
	});
});

describe('spendWarmBudget', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('spends the warm line only - subscription and purchased credits never move (issue #89)', async () => {
		const owner = await insertUser(db);
		const before = await getBalance(db, owner.id);

		const balance = await spendWarmBudget(db, {
			userId: owner.id,
			universeId: null,
			kind: 'brief',
			credits: 4
		});

		expect(balance.warmBudgetSpent).toBe(4);
		expect(balance.warmBudgetRemaining).toBe(FREE_PLAN_WARM_BUDGET_CREDITS - 4);
		expect(balance.subscriptionCredits).toBe(before.subscriptionCredits);
		expect(balance.purchasedCredits).toBe(before.purchasedCredits);

		const [txn] = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.userId, owner.id));
		expect(txn?.operation).toBe('warm:brief');
		expect(txn?.credits).toBe(-4);
	});

	it('refuses a spend past the warm ceiling and rolls back', async () => {
		const owner = await insertUser(db);
		await expect(
			spendWarmBudget(db, {
				userId: owner.id,
				universeId: null,
				kind: 'portrait',
				credits: FREE_PLAN_WARM_BUDGET_CREDITS + 1
			})
		).rejects.toThrow(WarmBudgetExhaustedError);

		const balance = await getBalance(db, owner.id);
		expect(balance.warmBudgetSpent).toBe(0);
	});

	it('a retry with the same idempotency key spends the warm line exactly once', async () => {
		const owner = await insertUser(db);
		const key = unique('warm-idempotency-key');

		const first = await spendWarmBudget(db, {
			userId: owner.id,
			universeId: null,
			kind: 'ambient_pack',
			credits: 3,
			idempotencyKey: key
		});
		const second = await spendWarmBudget(db, {
			userId: owner.id,
			universeId: null,
			kind: 'ambient_pack',
			credits: 3,
			idempotencyKey: key
		});

		expect(first.warmBudgetSpent).toBe(3);
		expect(second.warmBudgetSpent).toBe(3);
	});
});

describe('spendCredits - the balance-only half for a caller not priced per model call', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('spends the interactive balance and records a credit_transaction with no model_call attached', async () => {
		const owner = await insertUser(db);
		const operation = unique('import-doc-op');

		const { balance, alreadyCharged } = await spendCredits(db, {
			userId: owner.id,
			universeId: null,
			operation,
			credits: 12
		});

		expect(alreadyCharged).toBe(false);
		expect(balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS - 12);

		const [txn] = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.operation, operation));
		expect(txn?.credits).toBe(-12);
		expect(txn?.modelCallId).toBeNull();
	});

	it('points the credit_transaction row at a real model_call row when given one (issue #133)', async () => {
		const owner = await insertUser(db);
		const operation = unique('import-doc-op-linked');

		// A real model_call row from the same unit of work, exactly as
		// packages/import/src/job-runner.ts writes one per model call - at 0 credits,
		// since it is not itself what gets charged.
		const { modelCallId } = await recordAndCharge(
			db,
			callInput(owner.id, 0, { agent: 'import', operation: unique('import-cheap') })
		);

		const { balance } = await spendCredits(db, {
			userId: owner.id,
			universeId: null,
			operation,
			credits: 5,
			modelCallId
		});

		expect(balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS - 5);
		const [txn] = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.operation, operation));
		expect(txn?.credits).toBe(-5);
		expect(txn?.modelCallId).toBe(modelCallId);
	});

	it('a zero-credit spend never moves the balance', async () => {
		const owner = await insertUser(db);
		const before = await getBalance(db, owner.id);
		const { balance } = await spendCredits(db, {
			userId: owner.id,
			universeId: null,
			operation: unique('free-import-op'),
			credits: 0
		});
		expect(balance.subscriptionCredits).toBe(before.subscriptionCredits);
	});

	it('a retry with the same idempotency key spends exactly once', async () => {
		const owner = await insertUser(db);
		const key = unique('import-idempotency-key');
		const operation = unique('import-retry-op');

		const first = await spendCredits(db, {
			userId: owner.id,
			universeId: null,
			operation,
			credits: 8,
			idempotencyKey: key
		});
		const second = await spendCredits(db, {
			userId: owner.id,
			universeId: null,
			operation,
			credits: 8,
			idempotencyKey: key
		});

		expect(first.alreadyCharged).toBe(false);
		expect(second.alreadyCharged).toBe(true);
		expect(second.balance.subscriptionCredits).toBe(FREE_PLAN_SUBSCRIPTION_CREDITS - 8);
	});
});
