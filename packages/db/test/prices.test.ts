import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	listPrices,
	OperationNotPricedError,
	priceOf,
	setPrice,
	type Db
} from '../src/index.js';
import { operationPrice, operationPriceChange } from '../src/schema/prices.js';
import { expectConstraintViolation, testDb, unique } from './helpers.js';

// The full seeded catalogue from migrations/0004_seed_operation_price_catalogue.sql
// (SPEC.md §15, issue #113). Kept here rather than derived so a change to the seed data
// that silently drops or reprices a reading operation fails a test, not just a review.
const READING_OPERATIONS = ['index.embed', 'search.semantic', 'mention.suggest', 'ask.retrieval'];
const GENERATION_OPERATIONS = [
	'ask.answer',
	'propagate.plan',
	'propagate.diff',
	'entry.complete',
	'audit.flag',
	'image.portrait',
	'image.variants',
	'audio.layer',
	'warm.brief',
	'warm.npc_draft'
];
const IMPORT_OPERATIONS = ['import.document'];
const ALL_SEEDED_OPERATIONS = [
	...READING_OPERATIONS,
	...GENERATION_OPERATIONS,
	...IMPORT_OPERATIONS
];

describe('operation_price seeded catalogue', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('resolves every seeded operation', async () => {
		for (const operation of ALL_SEEDED_OPERATIONS) {
			await expect(priceOf(db, operation)).resolves.toMatchObject({ operation });
		}
	});

	it('prices every reading operation at exactly zero - reading is free (SPEC.md §15)', async () => {
		for (const operation of READING_OPERATIONS) {
			const price = await priceOf(db, operation);
			expect(price.credits).toBe(0);
			expect(price.kind).toBe('reading');
		}
	});

	it('listPrices returns the whole catalogue, ordered by kind then operation', async () => {
		const prices = await listPrices(db);
		const operations = prices.map((p) => p.operation);
		for (const operation of ALL_SEEDED_OPERATIONS) {
			expect(operations).toContain(operation);
		}
		// generation < import < reading alphabetically, so generation rows come first.
		const kinds = prices.map((p) => p.kind);
		const firstReadingIdx = kinds.indexOf('reading');
		const lastGenerationIdx = kinds.lastIndexOf('generation');
		expect(firstReadingIdx).toBeGreaterThan(lastGenerationIdx);
	});
});

describe('priceOf on an unpriced operation', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('throws, naming the operation, rather than returning a silent zero', async () => {
		const operation = unique('nonexistent-operation');
		await expect(priceOf(db, operation)).rejects.toThrow(OperationNotPricedError);
		await expect(priceOf(db, operation)).rejects.toThrow(operation);
	});
});

describe('setPrice', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	afterEach(async () => {
		if (!testOperation) return;
		// operation_price_change carries a fk to operation_price.operation, so the audit
		// rows have to go first.
		await db.delete(operationPriceChange).where(eq(operationPriceChange.operation, testOperation));
		await db.delete(operationPrice).where(eq(operationPrice.operation, testOperation));
		testOperation = '';
	});

	let testOperation = '';

	async function seedTestOperation(credits: number): Promise<void> {
		testOperation = unique('test.operation');
		await db.insert(operationPrice).values({
			operation: testOperation,
			label: 'Test operation',
			credits,
			kind: 'generation'
		});
	}

	it('throws, naming the operation, for an operation with no existing price row', async () => {
		const operation = unique('never-priced');
		await expect(setPrice(db, { operation, credits: 5 })).rejects.toThrow(OperationNotPricedError);
		await expect(setPrice(db, { operation, credits: 5 })).rejects.toThrow(operation);
	});

	it('changes the price and writes exactly one audit row with the old and new values, in one transaction', async () => {
		await seedTestOperation(2);

		const updated = await setPrice(db, {
			operation: testOperation,
			credits: 5.5,
			changedBy: 'lorenzo'
		});
		expect(updated.credits).toBe(5.5);

		const current = await priceOf(db, testOperation);
		expect(current.credits).toBe(5.5);

		const changes = await db
			.select()
			.from(operationPriceChange)
			.where(eq(operationPriceChange.operation, testOperation));
		expect(changes).toHaveLength(1);
		expect(changes[0]?.oldCredits).toBe(2);
		expect(changes[0]?.newCredits).toBe(5.5);
		expect(changes[0]?.changedBy).toBe('lorenzo');
	});

	it('a failed setPrice leaves neither the price change nor the audit row', async () => {
		await seedTestOperation(3);

		// operation_price_credits_non_negative rejects this update inside the transaction;
		// the audit insert that would follow it must never land either.
		await expectConstraintViolation(
			setPrice(db, { operation: testOperation, credits: -1 }),
			'operation_price_credits_non_negative'
		);

		const unchanged = await priceOf(db, testOperation);
		expect(unchanged.credits).toBe(3);

		const changes = await db
			.select()
			.from(operationPriceChange)
			.where(eq(operationPriceChange.operation, testOperation));
		expect(changes).toHaveLength(0);
	});
});
