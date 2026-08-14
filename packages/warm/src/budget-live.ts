/**
 * The production `WarmBudgetPort` (see budget.ts for the seam's contract): `allow` reads
 * the owning user's balance through @canonry/ai's `getBalance` and checks it with
 * `warmSpendAllowed`; `spend` writes through @canonry/db's `spendWarmBudget`, which is the
 * only place `user_billing.warm_budget_spent` is ever written.
 *
 * A candidate only carries `universeId`, not `userId` - the warm budget lives on
 * `user_billing`, keyed by the account that owns the universe, not by universe itself
 * (SPEC §8.1 calls it "a per-universe budget" in the sense that warming for a universe
 * always draws on its owner's line, separate from that owner's interactive spend; it does
 * not mean each universe carries its own independent pool). Resolving the owner is one
 * indexed lookup on `universe.id`, cheap enough to do per call rather than forcing every
 * caller (in particular `warmNightly`, which spans many universes with different owners
 * in one run) to pre-resolve and thread ownership through.
 */
import { getBalance, warmSpendAllowed, warmTierOf, WarmBudgetExhaustedError } from '@canonry/ai';
import { eq, spendWarmBudget, type Db } from '@canonry/db';
import { universe } from '@canonry/db/schema';
import type { WarmBudgetPort } from './budget.js';

async function ownerUserIdOf(db: Db, universeId: string): Promise<string> {
	const rows = await db
		.select({ ownerUserId: universe.ownerUserId })
		.from(universe)
		.where(eq(universe.id, universeId))
		.limit(1);
	const row = rows[0];
	if (!row) throw new Error(`createDbWarmBudgetPort: no universe ${universeId}`);
	return row.ownerUserId;
}

export function createDbWarmBudgetPort(db: Db): WarmBudgetPort {
	return {
		async allow(input) {
			const userId = await ownerUserIdOf(db, input.universeId);
			const balance = await getBalance(db, userId);
			return warmSpendAllowed({
				budgetTotal: balance.warmBudgetCredits,
				remaining: balance.warmBudgetRemaining,
				cost: input.credits,
				tier: warmTierOf(input.kind)
			});
		},
		async spend(input) {
			const userId = await ownerUserIdOf(db, input.universeId);
			try {
				await spendWarmBudget(db, {
					userId,
					universeId: input.universeId,
					kind: input.kind,
					credits: input.credits
				});
				return true;
			} catch (error) {
				if (error instanceof WarmBudgetExhaustedError) return false;
				throw error;
			}
		}
	};
}
