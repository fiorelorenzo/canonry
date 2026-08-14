import {
	closeDb,
	FREE_PLAN_SUBSCRIPTION_CREDITS,
	getBalance,
	InsufficientCreditsError,
	type Db
} from '@canonry/db';
import {
	modelCall,
	operationPrice,
	operationPriceChange,
	user,
	userBilling
} from '@canonry/db/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedModel } from './models.js';
import { openTestDb } from './test-db.js';
import { warmSpendAllowed, warmTierOf, withQuota, type WarmTier } from './quota.js';

const RESOLVED_MODEL: ResolvedModel = {
	purpose: 'cheap',
	provider: 'test-provider',
	modelId: 'test-model-quota',
	params: { eurPerInputMTok: 2, eurPerOutputMTok: 6, creditsPerEur: 100 }
};

describe('warmTierOf', () => {
	it('sorts the five warm artifact kinds into media, draft, text (SPEC.md §8.1)', () => {
		expect(warmTierOf('ambient_pack')).toBe('media');
		expect(warmTierOf('portrait')).toBe('media');
		expect(warmTierOf('npc_draft')).toBe('draft');
		expect(warmTierOf('brief')).toBe('text');
		expect(warmTierOf('context_pack')).toBe('text');
	});
});

describe('warmSpendAllowed - the fixed degradation order (SPEC.md §8.1)', () => {
	const budgetTotal = 100;

	// A single walk down the budget from full to empty: at every point, whichever
	// tiers are still allowed must be exactly the ones the fixed order predicts.
	// text is never blocked before it runs out; draft is blocked strictly before
	// text; media is blocked strictly before draft.
	it('media is blocked first, then drafts, text spends all the way to zero', () => {
		const cost = 5;
		const tiers: WarmTier[] = ['media', 'draft', 'text'];
		let firstBlocked: Partial<Record<WarmTier, number>> = {};

		for (let remaining = budgetTotal; remaining >= 0; remaining -= cost) {
			for (const tier of tiers) {
				const allowed = warmSpendAllowed({ budgetTotal, remaining, cost, tier });
				if (!allowed && firstBlocked[tier] === undefined) {
					firstBlocked[tier] = remaining;
				}
			}
		}

		expect(firstBlocked.media).toBeGreaterThan(firstBlocked.draft!);
		expect(firstBlocked.draft).toBeGreaterThan(firstBlocked.text!);
		// text has no reserve: it is only ever blocked once the remaining budget can no
		// longer cover the cost of the call itself.
		expect(firstBlocked.text).toBeLessThan(cost);
	});

	it('media reserves 30% of the total budget, draft reserves 10%, text reserves nothing', () => {
		expect(warmSpendAllowed({ budgetTotal: 100, remaining: 35, cost: 5, tier: 'media' })).toBe(
			true
		);
		expect(warmSpendAllowed({ budgetTotal: 100, remaining: 34, cost: 5, tier: 'media' })).toBe(
			false
		);
		expect(warmSpendAllowed({ budgetTotal: 100, remaining: 15, cost: 5, tier: 'draft' })).toBe(
			true
		);
		expect(warmSpendAllowed({ budgetTotal: 100, remaining: 14, cost: 5, tier: 'draft' })).toBe(
			false
		);
		expect(warmSpendAllowed({ budgetTotal: 100, remaining: 5, cost: 5, tier: 'text' })).toBe(true);
		expect(warmSpendAllowed({ budgetTotal: 100, remaining: 4, cost: 5, tier: 'text' })).toBe(false);
	});
});

describe('withQuota against real Postgres', () => {
	let db: Db;
	const TEST_OPERATION_PREFIX = 'canonry-ai-test-quota-';
	const CHARGED_OPERATION = `${TEST_OPERATION_PREFIX}charged`;
	const FREE_OPERATION = `${TEST_OPERATION_PREFIX}free`;
	const FAILING_OPERATION = `${TEST_OPERATION_PREFIX}failing`;
	const BYO_OPERATION = `${TEST_OPERATION_PREFIX}byo`;
	const CHARGED_PRICE_CREDITS = 10;
	const TEST_USER_IDS = [
		'quota-test-user-1',
		'quota-test-user-2',
		'quota-test-user-3',
		'quota-test-user-poor',
		'quota-test-user-byo'
	];

	beforeAll(async () => {
		db = openTestDb();
		await db
			.insert(user)
			.values(
				TEST_USER_IDS.map((id) => ({
					id,
					name: 'Quota Test User',
					email: `${id}@canonry.invalid`,
					emailVerified: true
				}))
			)
			.onConflictDoNothing();
		await db.insert(operationPrice).values([
			{
				operation: CHARGED_OPERATION,
				label: 'Test charged op',
				credits: CHARGED_PRICE_CREDITS,
				kind: 'generation'
			},
			{ operation: FREE_OPERATION, label: 'Test free op', credits: 0, kind: 'reading' },
			{
				operation: FAILING_OPERATION,
				label: 'Test failing op',
				credits: CHARGED_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: BYO_OPERATION,
				label: 'Test byo-key op',
				credits: CHARGED_PRICE_CREDITS,
				kind: 'generation'
			}
		]);
	});

	afterAll(async () => {
		await db.delete(modelCall).where(like(modelCall.operation, `${TEST_OPERATION_PREFIX}%`));
		await db
			.delete(operationPriceChange)
			.where(like(operationPriceChange.operation, `${TEST_OPERATION_PREFIX}%`));
		await db
			.delete(operationPrice)
			.where(like(operationPrice.operation, `${TEST_OPERATION_PREFIX}%`));
		await db.delete(user).where(inArray(user.id, TEST_USER_IDS));
		await closeDb(db);
	});

	it('a free/reading operation records the call but never moves the balance - a search does not move the meter', async () => {
		const userId = 'quota-test-user-1';
		const before = await getBalance(db, userId);

		const result = await withQuota(
			db,
			RESOLVED_MODEL,
			{ userId, universeId: null, agent: 'indexing', operation: FREE_OPERATION },
			async () => ({ text: 'search hit', usage: { inputTokens: 5, outputTokens: 0 } }),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens
				})
			}
		);

		expect(result.text).toBe('search hit');
		const after = await getBalance(db, userId);
		expect(after.totalCredits).toBe(before.totalCredits);
		expect(after.subscriptionCredits).toBe(before.subscriptionCredits);
	});

	it('a charged operation decrements the balance exactly once', async () => {
		const userId = 'quota-test-user-2';
		await getBalance(db, userId); // ensure the free-plan row exists first

		await withQuota(
			db,
			RESOLVED_MODEL,
			{ userId, universeId: null, agent: 'propagate', operation: CHARGED_OPERATION },
			async () => ({ text: 'a draft', usage: { inputTokens: 100, outputTokens: 40 } }),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens
				})
			}
		);

		const balance = await getBalance(db, userId);
		expect(balance.subscriptionCredits).toBe(
			FREE_PLAN_SUBSCRIPTION_CREDITS - CHARGED_PRICE_CREDITS
		);
	});

	it('refuses a call whose price exceeds the balance before fn() ever runs', async () => {
		const userId = 'quota-test-user-poor';
		await getBalance(db, userId); // ensure the free-plan row exists before shrinking it
		await db
			.update(userBilling)
			.set({ subscriptionCredits: 1, purchasedCredits: 0 })
			.where(eq(userBilling.userId, userId));

		let fnRan = false;
		await expect(
			withQuota(
				db,
				RESOLVED_MODEL,
				{ userId, universeId: null, agent: 'propagate', operation: CHARGED_OPERATION },
				async () => {
					fnRan = true;
					return { text: 'never', usage: { inputTokens: 1, outputTokens: 1 } };
				},
				{
					extractUsage: (r) => ({
						inputTokens: r.usage.inputTokens,
						outputTokens: r.usage.outputTokens
					})
				}
			)
		).rejects.toBeInstanceOf(InsufficientCreditsError);
		expect(fnRan).toBe(false);
	});

	it('records the call but never charges when the wrapped call throws', async () => {
		const userId = 'quota-test-user-3';
		const before = await getBalance(db, userId);

		await expect(
			withQuota(
				db,
				RESOLVED_MODEL,
				{ userId, universeId: null, agent: 'propagate', operation: FAILING_OPERATION },
				async () => {
					throw new Error('provider unavailable');
				},
				{ extractUsage: () => ({}), extractUsageOnError: () => ({ inputTokens: 20 }) }
			)
		).rejects.toThrow('provider unavailable');

		const after = await getBalance(db, userId);
		expect(after.subscriptionCredits).toBe(before.subscriptionCredits);

		const [row] = await db
			.select()
			.from(modelCall)
			.where(like(modelCall.operation, FAILING_OPERATION));
		expect(row?.inputTokens).toBe(20);
		expect(row?.credits).toBe(0);
	});

	it('a BYO-key call (issue #90) charges 0 credits but still records real usage', async () => {
		const userId = 'quota-test-user-byo';
		const before = await getBalance(db, userId);

		const result = await withQuota(
			db,
			RESOLVED_MODEL,
			{
				userId,
				universeId: null,
				agent: 'propagate',
				operation: BYO_OPERATION,
				byoKey: true
			},
			async () => ({ text: 'paid for directly', usage: { inputTokens: 200, outputTokens: 80 } }),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens,
					outputTokens: r.usage.outputTokens
				})
			}
		);

		expect(result.text).toBe('paid for directly');
		// The operation is priced at CHARGED_PRICE_CREDITS, but the user's own key paid
		// the provider directly - the balance must not move at all.
		const after = await getBalance(db, userId);
		expect(after.subscriptionCredits).toBe(before.subscriptionCredits);

		const [row] = await db.select().from(modelCall).where(like(modelCall.operation, BYO_OPERATION));
		expect(row?.credits).toBe(0);
		expect(row?.inputTokens).toBe(200);
		expect(row?.outputTokens).toBe(80);
		// Real cost is still on record (SPEC.md §15's margin question - "free to the user
		// is not free to us") even though nothing was charged.
		expect(row ? Number(row.costEur) > 0 : false).toBe(true);
	});
});
