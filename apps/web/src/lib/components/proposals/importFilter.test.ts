import { describe, expect, it } from 'vitest';
import { computeFilterBuckets, type FilterCandidate } from './importFilter';

describe('computeFilterBuckets', () => {
	it('puts "All" first, counting every candidate regardless of type or outcome', () => {
		const candidates: FilterCandidate[] = [
			{ id: '1', filterType: 'character', outcome: 'pending' },
			{ id: '2', filterType: 'place', outcome: 'accepted' },
			{ id: '3', filterType: 'relation', outcome: 'rejected' }
		];
		const buckets = computeFilterBuckets(candidates);
		expect(buckets[0]).toEqual({ type: null, label: 'All', total: 3, pending: 1 });
	});

	it('emits one chip per type actually present, in SPEC order, relations last', () => {
		const candidates: FilterCandidate[] = [
			{ id: '1', filterType: 'relation', outcome: 'pending' },
			{ id: '2', filterType: 'place', outcome: 'pending' },
			{ id: '3', filterType: 'character', outcome: 'pending' }
		];
		const buckets = computeFilterBuckets(candidates);
		expect(buckets.map((b) => b.type)).toEqual([null, 'character', 'place', 'relation']);
	});

	it('never emits a chip for a type nobody proposed', () => {
		const candidates: FilterCandidate[] = [
			{ id: '1', filterType: 'character', outcome: 'pending' }
		];
		const buckets = computeFilterBuckets(candidates);
		expect(buckets.some((b) => b.type === 'item')).toBe(false);
	});

	it('counts total (any outcome) separately from pending (what a bulk reject would touch)', () => {
		const candidates: FilterCandidate[] = [
			{ id: '1', filterType: 'faction', outcome: 'pending' },
			{ id: '2', filterType: 'faction', outcome: 'accepted' },
			{ id: '3', filterType: 'faction', outcome: 'rejected' }
		];
		const buckets = computeFilterBuckets(candidates);
		const factions = buckets.find((b) => b.type === 'faction');
		expect(factions).toEqual({ type: 'faction', label: 'Factions', total: 3, pending: 1 });
	});

	it('labels a type outside the known six-plus-relation set with the raw string, never drops it', () => {
		const candidates: FilterCandidate[] = [{ id: '1', filterType: 'mystery', outcome: 'pending' }];
		const buckets = computeFilterBuckets(candidates);
		expect(buckets.find((b) => b.type === 'mystery')).toEqual({
			type: 'mystery',
			label: 'mystery',
			total: 1,
			pending: 1
		});
	});

	it('returns just the "All" bucket for an empty job', () => {
		expect(computeFilterBuckets([])).toEqual([{ type: null, label: 'All', total: 0, pending: 0 }]);
	});
});
