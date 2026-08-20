// #348: the world home's masthead has three states, and which one it is in is the whole
// decision this file guards. The one that matters most is `unwritten`: a masthead that drew
// twelve empty bars and a sentence full of zeroes on a world nobody has written yet would
// read worse than the three figures it replaced.
import { describe, expect, it } from 'vitest';
import { PULSE_WEEKS, worldPulse } from './world-pulse';

describe('worldPulse', () => {
	it('says nothing at all about a world with no entries and no history', () => {
		expect(worldPulse({ entryCount: 0, counts: [], lastChangeAt: null })).toEqual({
			kind: 'unwritten'
		});
	});

	it('is quiet, not unwritten, for a world that has entries but has not moved', () => {
		const lastChangeAt = new Date('2026-04-02T10:00:00Z');
		expect(worldPulse({ entryCount: 17, counts: [], lastChangeAt })).toEqual({
			kind: 'quiet',
			lastChangeAt
		});
	});

	it('is quiet with no date when the world carries no dated event', () => {
		expect(worldPulse({ entryCount: 3, counts: [] })).toEqual({
			kind: 'quiet',
			lastChangeAt: null
		});
	});

	it('lays the buckets out oldest first, with the newest week last', () => {
		const pulse = worldPulse({
			entryCount: 17,
			counts: [
				{ weeksAgo: 0, count: 6 },
				{ weeksAgo: 3, count: 2 },
				{ weeksAgo: 11, count: 1 }
			]
		});
		if (pulse.kind !== 'moving') throw new Error(`expected a moving pulse, got ${pulse.kind}`);
		expect(pulse.weeks).toHaveLength(PULSE_WEEKS);
		expect(pulse.weeks[0]).toBe(1);
		expect(pulse.weeks[PULSE_WEEKS - 4]).toBe(2);
		expect(pulse.weeks[PULSE_WEEKS - 1]).toBe(6);
		expect(pulse.total).toBe(9);
		expect(pulse.latest).toBe(6);
		expect(pulse.peak).toBe(6);
	});

	it('reports a stalled world as moving with nothing in the newest week', () => {
		const pulse = worldPulse({ entryCount: 17, counts: [{ weeksAgo: 5, count: 4 }] });
		if (pulse.kind !== 'moving') throw new Error(`expected a moving pulse, got ${pulse.kind}`);
		expect(pulse.latest).toBe(0);
		expect(pulse.total).toBe(4);
	});

	it('drops a bucket outside the window rather than writing past the array', () => {
		const pulse = worldPulse({
			entryCount: 17,
			counts: [
				{ weeksAgo: PULSE_WEEKS, count: 99 },
				{ weeksAgo: -1, count: 99 },
				{ weeksAgo: 0, count: 1 }
			]
		});
		if (pulse.kind !== 'moving') throw new Error(`expected a moving pulse, got ${pulse.kind}`);
		expect(pulse.weeks).toHaveLength(PULSE_WEEKS);
		expect(pulse.total).toBe(1);
	});

	it('counts a world with works but no entries as moving, not unwritten', () => {
		const pulse = worldPulse({ entryCount: 0, counts: [{ weeksAgo: 1, count: 2 }] });
		expect(pulse.kind).toBe('moving');
	});
});
