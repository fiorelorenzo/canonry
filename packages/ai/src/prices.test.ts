import { randomUUID } from 'node:crypto';
import { closeDb, setPrice, type Db } from '@canonry/db';
import { operationPrice, operationPriceChange } from '@canonry/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeFor, clearPriceCache } from './prices.js';
import { openTestDb } from './test-db.js';

function uniqueOperation(): string {
	return `canonry-ai-test-price-${randomUUID().slice(0, 8)}`;
}

describe('chargeFor', () => {
	let db: Db;
	let operation: string;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	beforeEach(async () => {
		clearPriceCache();
		operation = uniqueOperation();
		await db.insert(operationPrice).values({
			operation,
			label: 'Test priced operation',
			credits: 4,
			kind: 'generation'
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.delete(operationPriceChange).where(eq(operationPriceChange.operation, operation));
		await db.delete(operationPrice).where(eq(operationPrice.operation, operation));
	});

	it('resolves the current price row for an operation', async () => {
		const price = await chargeFor(db, operation);
		expect(price.credits).toBe(4);
		expect(price.operation).toBe(operation);
	});

	it('caches the resolved price for the TTL, then refetches after it expires', async () => {
		const nowSpy = vi.spyOn(Date, 'now');
		const baseTime = 1_700_000_000_000;
		nowSpy.mockReturnValue(baseTime);

		const first = await chargeFor(db, operation);
		expect(first.credits).toBe(4);

		// Admin edits the price directly (bypassing setPrice - the cache does not know).
		await db
			.update(operationPrice)
			.set({ credits: 9 })
			.where(eq(operationPrice.operation, operation));

		// Still within the 30s TTL: cache holds, stale value returned.
		nowSpy.mockReturnValue(baseTime + 29_000);
		const stillCached = await chargeFor(db, operation);
		expect(stillCached.credits).toBe(4);

		// Past the TTL: cache expired, the edit is now visible.
		nowSpy.mockReturnValue(baseTime + 30_001);
		const refreshed = await chargeFor(db, operation);
		expect(refreshed.credits).toBe(9);
	});

	it('clearPriceCache empties the cache immediately, without waiting for the TTL', async () => {
		const nowSpy = vi.spyOn(Date, 'now');
		const baseTime = 1_700_000_000_000;
		nowSpy.mockReturnValue(baseTime);

		await chargeFor(db, operation);
		await db
			.update(operationPrice)
			.set({ credits: 7 })
			.where(eq(operationPrice.operation, operation));

		nowSpy.mockReturnValue(baseTime + 1_000);
		clearPriceCache();
		const afterClear = await chargeFor(db, operation);
		expect(afterClear.credits).toBe(7);
	});

	it('a price changed through setPrice is visible immediately after clearPriceCache', async () => {
		await chargeFor(db, operation);
		await setPrice(db, { operation, credits: 12.5, changedBy: 'lorenzo' });

		// Still cached: the stale value would still win without an explicit clear.
		const stillStale = await chargeFor(db, operation);
		expect(stillStale.credits).toBe(4);

		clearPriceCache();
		const afterClear = await chargeFor(db, operation);
		expect(afterClear.credits).toBe(12.5);
	});
});
