/**
 * SPEC.md §14 point 3, issue #102: "warm hit rate: consumed artifacts over generated
 * ones. It governs the warm radius automatically - below threshold, shrink from ring 2 to
 * ring 1." Trigger 3 (`warmOnTableOpen`) always covers ring 1 as table mode's safety net,
 * so it is trigger 4 (`warmOnConsumption`, triggers.ts) that has a radius to shrink: it is
 * the one that reaches speculatively to ring 2 when the party enters a new place mid
 * session. When the hit rate says that speculation rarely gets used, pulling back to ring
 * 1 still warms something a GM is likely to need next (the entered place's immediate
 * neighbors) instead of spending on material two hops out that keeps going unconsumed.
 *
 * This module is the pure decision (`warmRadiusFor`) plus the one read that feeds both the
 * trigger and the admin metrics panel (`currentWarmRadius`), so the radius a trigger
 * actually warms to and the radius the admin surface displays are never two independent
 * computations that could disagree.
 */
import { warmHitRate, type Db } from '@canonry/db';

export type WarmRadius = 1 | 2;

/**
 * Below this hit rate, ring 2 speculation is pulled back to ring 1. Ring 1 is already
 * covered by trigger 3's safety net on every table-open, so ring 2 has to justify its own
 * cost (SPEC §8.1's anchor: a warmed layer is not free, 3-10s and real credits against a
 * generation provider) rather than merely not losing to it - 30% is a deliberately low bar
 * for "worth reaching further than the safety net already reaches", not a break-even point.
 */
export const WARM_RADIUS_HIT_RATE_THRESHOLD = 0.3;

/**
 * Below the threshold, ring 1. At or above it, ring 2. With no data yet (`hitRate: null`,
 * nothing generated for this universe), also ring 2 - there is nothing yet to justify
 * pulling back, and a brand new universe should get the full speculative reach until its
 * own hit rate says otherwise.
 */
export function warmRadiusFor(hitRate: number | null): WarmRadius {
	if (hitRate === null) return 2;
	return hitRate < WARM_RADIUS_HIT_RATE_THRESHOLD ? 1 : 2;
}

export interface WarmRadiusDecision {
	consumed: number;
	generated: number;
	hitRate: number | null;
	radius: WarmRadius;
}

/** Reads the universe's current warm hit rate and applies `warmRadiusFor` to it. Trigger 4
 * calls this to decide how far to reach; the admin metrics panel calls it to show the
 * radius next to the hit rate that chose it (issue #102's acceptance: "show the current
 * radius and the hit rate that chose it"). */
export async function currentWarmRadius(db: Db, universeId: string): Promise<WarmRadiusDecision> {
	const stats = await warmHitRate(db, universeId);
	return { ...stats, radius: warmRadiusFor(stats.hitRate) };
}
