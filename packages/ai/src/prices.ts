/**
 * DB-driven per-operation credit pricing (SPEC.md §15, issue #113). The credit price of
 * every chargeable operation lives in `operation_price`, not in code, so an admin can
 * change it without a deploy - the same shape `resolveModel` (models.ts) already uses for
 * model routing, and `withUsage` (usage.ts) is the only caller that has to know this
 * module exists.
 */
import type { Db, PriceRow } from '@canonry/db';
import { priceOf } from '@canonry/db';

export type { PriceRow };

/**
 * 30s TTL, keyed per operation, mirroring `resolveModel`'s cache in models.ts and for the
 * same reason: this sits on a hot path (every chargeable AI call resolves a price through
 * it), so a per-call round trip to Postgres would be wasteful, but the cache still has to
 * stay short enough that an admin's edit does not look broken for a while. The admin save
 * calls `clearPriceCache()` itself, so an edit is visible on the very next request either
 * way - the TTL only bounds staleness for a cache nobody explicitly cleared.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
	value: PriceRow;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearPriceCache(): void {
	cache.clear();
}

/** Resolves an operation's current credit price through the cache above. Throws the same
 * error as `@canonry/db`'s `priceOf` for an operation with no `operation_price` row - a
 * missing price fails loudly rather than silently charging nothing (SPEC.md §15). */
export async function chargeFor(db: Db, operation: string): Promise<PriceRow> {
	const now = Date.now();
	const cached = cache.get(operation);
	if (cached && cached.expiresAt > now) return cached.value;

	const price = await priceOf(db, operation);
	cache.set(operation, { value: price, expiresAt: now + CACHE_TTL_MS });
	return price;
}
