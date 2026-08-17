import { describe, expect, it } from 'vitest';
import { toEur } from './currency.js';

describe('toEur (issue #132)', () => {
	it('converts a USD price at the single dated rate', () => {
		// Replicate's list price for prunaai/p-image, issue #132: $0.02 at 1 EUR = 1.1567
		// USD is ~0.017291 EUR, which is what migration 0034 restates the row to expect
		// read-time, not what it stores.
		expect(toEur(0.02, 'USD')).toBeCloseTo(0.017291, 5);
		expect(toEur(0.01, 'USD')).toBeCloseTo(0.008645, 5);
	});

	it('passes a price already stored in euros through unchanged', () => {
		expect(toEur(4.32, 'EUR')).toBe(4.32);
		expect(toEur(0, 'EUR')).toBe(0);
	});
});
