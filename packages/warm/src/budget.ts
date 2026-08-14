/**
 * SPEC.md §8.1 and §15, issue #78: "warming draws on a per-universe budget distinct from
 * interactive use. When it runs out the system degrades in a fixed order: media first,
 * then drafts, text last."
 *
 * The actual balance lives on `user_billing` (@canonry/db's `spendWarmBudget`) and the
 * spend decision's threshold math lives in @canonry/ai's quota module (`warmTierOf`,
 * `warmSpendAllowed`), since both are shared with interactive spend - this module never
 * reimplements either. What belongs here is ordering: attempting candidates in the
 * sequence that makes the fixed degradation order an emergent property of ordinary
 * sequential spending, and the seam (`WarmBudgetPort`) that lets triggers/store stay
 * testable without a database.
 */
import { warmSpendAllowed, warmTierOf, type WarmTier } from '@canonry/ai';
import type { WarmArtifactKind } from '@canonry/db/schema';

export { warmTierOf, type WarmTier };

// SPEC's degradation order names what gets *cut* first: media, then drafts, text last.
// Attempting candidates in the reverse of that order - text first, media last - means a
// budget that runs dry partway through a batch always strands the low-priority tail
// (media), never the protected head (text), without any per-candidate special case.
const ATTEMPT_ORDER: Record<WarmTier, number> = { text: 0, draft: 1, media: 2 };

/** Stable sort into attempt order. Candidates within the same tier keep their relative
 * order, so a caller that already ranked them (e.g. by relevance) does not have that
 * undone. */
export function sortByDegradationOrder<T extends { kind: WarmArtifactKind }>(candidates: T[]): T[] {
	return [...candidates]
		.map((candidate, index) => ({ candidate, index }))
		.sort((a, b) => {
			const tierDelta =
				ATTEMPT_ORDER[warmTierOf(a.candidate.kind)] - ATTEMPT_ORDER[warmTierOf(b.candidate.kind)];
			return tierDelta !== 0 ? tierDelta : a.index - b.index;
		})
		.map(({ candidate }) => candidate);
}

/** The seam between this package's trigger orchestration and the real warm budget: a
 * pre-generation permission check (so an expensive generator call is never made only to
 * be thrown away when the budget cannot cover it) and a post-generation spend attempt.
 * `spend` returns `false` rather than throwing when the authoritative balance can no
 * longer cover the charge (a race against a concurrent spend since `allow` was checked,
 * or a balance that moved for any other reason) - the caller's job on `false` is to
 * discard what it just generated rather than store something nobody paid for, never to
 * treat the exception as unexpected. `createDbWarmBudgetPort` (budget-live.ts) is the
 * production implementation, wired to @canonry/db's `spendWarmBudget` (which throws
 * `WarmBudgetExhaustedError` on that same race - the live port catches it and returns
 * `false`); tests can supply `createInMemoryWarmBudgetPort` instead, the same seam
 * discipline packages/import's driver and packages/eval's injected selectors already
 * use. */
export interface WarmBudgetPort {
	allow(input: { universeId: string; kind: WarmArtifactKind; credits: number }): Promise<boolean>;
	spend(input: {
		universeId: string;
		kind: WarmArtifactKind;
		subjectEntityId: string | null;
		credits: number;
	}): Promise<boolean>;
}

/** A fixed-total budget that runs its allow/spend decisions through @canonry/ai's actual
 * `warmSpendAllowed`, so a test exercising this port is exercising the production
 * degradation math itself rather than a parallel reimplementation of it. Exists for
 * store/trigger tests that need *a* degrading budget without a database; production goes
 * through `createDbWarmBudgetPort` instead. */
export function createInMemoryWarmBudgetPort(total: number): WarmBudgetPort & { spent: number } {
	const state = {
		spent: 0,
		async allow(input: { kind: WarmArtifactKind; credits: number }): Promise<boolean> {
			return warmSpendAllowed({
				budgetTotal: total,
				remaining: total - state.spent,
				cost: input.credits,
				tier: warmTierOf(input.kind)
			});
		},
		async spend(input: { kind: WarmArtifactKind; credits: number }): Promise<boolean> {
			const allowed = await state.allow(input);
			if (!allowed) return false;
			state.spent += input.credits;
			return true;
		}
	};
	return state;
}
