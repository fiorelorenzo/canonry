/**
 * The rows every bench run needs before it can call anything: a user, a universe, and a
 * credit balance large enough that `withQuota` never refuses.
 *
 * This exists because the bench runs the product's own functions rather than a copy of
 * their prompts, and those functions charge. `withQuota` reads `user_billing`, refuses on
 * `InsufficientCreditsError`, and writes a `model_call` row plus a `credit_transaction` in
 * one transaction. That is the behaviour worth exercising, so the fixture tops the balance
 * up rather than bypassing the check: a run that hits the ceiling should be a run that
 * spent a lot, not a run whose accounting was stubbed out.
 */
import { eq, type Db } from '@canonry/db';
import { universe, universeMember, user, userBilling } from '@canonry/db/schema';

export const BENCH_USER_ID = 'bench-owner';
export const BENCH_UNIVERSE_SLUG = 'bench-valdoria-reach';

/** Credits, not euros. One propagation diff costs 1, an Ask answer 2, so this is several
 * thousand model calls' worth: enough that a full sweep never trips the ceiling, small
 * enough that a runaway loop still stops. */
const BENCH_CREDITS = 500_000;

export interface BenchFixture {
	userId: string;
	universeId: string;
}

let cached: BenchFixture | null = null;

export async function benchFixture(db: Db): Promise<BenchFixture> {
	if (cached) return cached;

	await db
		.insert(user)
		.values({
			id: BENCH_USER_ID,
			name: 'Bench Owner',
			email: 'bench@canonry.invalid',
			emailVerified: true
		})
		.onConflictDoNothing();

	await db
		.insert(userBilling)
		.values([
			{
				userId: BENCH_USER_ID,
				subscriptionCredits: BENCH_CREDITS,
				warmBudgetCredits: BENCH_CREDITS
			}
		])
		.onConflictDoUpdate({
			target: userBilling.userId,
			set: {
				subscriptionCredits: BENCH_CREDITS,
				warmBudgetCredits: BENCH_CREDITS,
				warmBudgetSpent: 0
			}
		});

	const existing = await db
		.select({ id: universe.id })
		.from(universe)
		.where(eq(universe.slug, BENCH_UNIVERSE_SLUG))
		.limit(1);

	let universeId = existing[0]?.id;
	if (!universeId) {
		const inserted = await db
			.insert(universe)
			.values({
				ownerUserId: BENCH_USER_ID,
				name: 'Valdoria Reach (bench)',
				slug: BENCH_UNIVERSE_SLUG,
				kind: 'homebrew'
			})
			.returning({ id: universe.id });
		universeId = inserted[0]?.id;
		if (!universeId) throw new Error('bench universe insert returned no row');
		await db
			.insert(universeMember)
			.values({ universeId, userId: BENCH_USER_ID, role: 'owner' })
			.onConflictDoNothing();
	}

	cached = { userId: BENCH_USER_ID, universeId };
	return cached;
}

/** Puts the balance back after a sweep has eaten into it. Cheap, and it keeps a long run
 * from turning into a quota test halfway through. */
export async function topUpCredits(db: Db): Promise<void> {
	await db
		.update(userBilling)
		.set({ subscriptionCredits: BENCH_CREDITS, warmBudgetSpent: 0 })
		.where(eq(userBilling.userId, BENCH_USER_ID));
}
