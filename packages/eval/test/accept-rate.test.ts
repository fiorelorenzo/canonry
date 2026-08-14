import { describe, expect, it } from 'vitest';
import { acceptRate, acceptRateByGroup } from '../src/propagation/accept-rate.js';

describe('acceptRate', () => {
	it('divides accepted by decided, ignoring pending proposals', () => {
		const result = acceptRate([
			{ outcome: 'accepted' },
			{ outcome: 'accepted' },
			{ outcome: 'rejected' },
			{ outcome: 'pending' }
		]);
		expect(result.accepted).toBe(2);
		expect(result.rejected).toBe(1);
		expect(result.pending).toBe(1);
		expect(result.produced).toBe(4);
		expect(result.decided).toBe(3);
		expect(result.acceptRate).toBeCloseTo(2 / 3);
	});

	it('returns null rather than a misleading zero when nothing has been decided', () => {
		const result = acceptRate([{ outcome: 'pending' }, { outcome: 'pending' }]);
		expect(result.acceptRate).toBeNull();
		expect(acceptRate([]).acceptRate).toBeNull();
	});

	it('excludes superseded proposals from the decided denominator, same as pending', () => {
		const result = acceptRate([
			{ outcome: 'accepted' },
			{ outcome: 'rejected' },
			{ outcome: 'superseded' },
			{ outcome: 'superseded' }
		]);
		expect(result.superseded).toBe(2);
		expect(result.produced).toBe(4);
		expect(result.decided).toBe(2);
		expect(result.acceptRate).toBe(0.5);
	});

	it('reports 1 when every decided proposal was accepted', () => {
		expect(acceptRate([{ outcome: 'accepted' }, { outcome: 'accepted' }]).acceptRate).toBe(1);
	});
});

describe('acceptRateByGroup', () => {
	it('breaks the rate out per group, per SPEC.md §14 #6 ("per playbook, not in aggregate")', () => {
		const byGroup = acceptRateByGroup([
			{ outcome: 'accepted', group: 'obsidian' },
			{ outcome: 'accepted', group: 'obsidian' },
			{ outcome: 'rejected', group: 'obsidian' },
			{ outcome: 'rejected', group: 'world-anvil' },
			{ outcome: 'rejected', group: 'world-anvil' }
		]);
		expect(byGroup.get('obsidian')?.acceptRate).toBeCloseTo(2 / 3);
		expect(byGroup.get('world-anvil')?.acceptRate).toBe(0);
	});

	it('collects ungrouped records under a stable key', () => {
		const byGroup = acceptRateByGroup([{ outcome: 'accepted' }]);
		expect(byGroup.get('ungrouped')?.acceptRate).toBe(1);
	});
});
