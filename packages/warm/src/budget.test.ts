import { describe, expect, it } from 'vitest';
import { createInMemoryWarmBudgetPort, sortByDegradationOrder, warmTierOf } from './budget.js';

describe('warmTierOf', () => {
	it('classifies every warm artifact kind into exactly one tier', () => {
		expect(warmTierOf('brief')).toBe('text');
		expect(warmTierOf('context_pack')).toBe('text');
		expect(warmTierOf('npc_draft')).toBe('draft');
		expect(warmTierOf('ambient_pack')).toBe('media');
		expect(warmTierOf('portrait')).toBe('media');
	});
});

describe('sortByDegradationOrder', () => {
	it('attempts text first, then drafts, then media - the reverse of what gets cut', () => {
		const candidates = [
			{ kind: 'portrait' as const, id: 'a' },
			{ kind: 'brief' as const, id: 'b' },
			{ kind: 'npc_draft' as const, id: 'c' },
			{ kind: 'ambient_pack' as const, id: 'd' },
			{ kind: 'context_pack' as const, id: 'e' }
		];
		const sorted = sortByDegradationOrder(candidates).map((c) => c.id);
		expect(sorted).toEqual(['b', 'e', 'c', 'a', 'd']);
	});

	it('keeps relative order within the same tier (stable sort)', () => {
		const candidates = [
			{ kind: 'context_pack' as const, id: 'first' },
			{ kind: 'brief' as const, id: 'second' },
			{ kind: 'brief' as const, id: 'third' }
		];
		expect(sortByDegradationOrder(candidates).map((c) => c.id)).toEqual([
			'first',
			'second',
			'third'
		]);
	});
});

describe('createInMemoryWarmBudgetPort', () => {
	it('degrades in the fixed order: media stops first, then drafts, text spends to zero', async () => {
		// A small total with three roughly-equal charges makes the reserve boundaries land
		// where each tier's cutoff is unambiguous.
		const port = createInMemoryWarmBudgetPort(100);

		// Spend down past media's floor (30% of 100 = 30 reserved for draft+text) but still
		// above draft's floor (10 reserved for text).
		expect(
			await port.spend({ universeId: 'u1', kind: 'brief', subjectEntityId: null, credits: 65 })
		).toBe(true);

		// 35 remains: media needs to leave 30 behind, so a 10-credit media spend (leaving 25,
		// below the 30 floor) is refused - media is the first tier to run dry.
		expect(await port.allow({ universeId: 'u1', kind: 'portrait', credits: 10 })).toBe(false);
		expect(
			await port.spend({ universeId: 'u1', kind: 'portrait', subjectEntityId: null, credits: 10 })
		).toBe(false);

		// A draft only needs to leave 10 behind for text, so it still fits.
		expect(await port.allow({ universeId: 'u1', kind: 'npc_draft', credits: 10 })).toBe(true);
		expect(
			await port.spend({ universeId: 'u1', kind: 'npc_draft', subjectEntityId: null, credits: 10 })
		).toBe(true);

		// 25 remains, all reserved for text; a further draft (needs to leave 10 for text) of
		// 20 credits would breach that reserve and is refused.
		expect(
			await port.spend({ universeId: 'u1', kind: 'npc_draft', subjectEntityId: null, credits: 20 })
		).toBe(false);

		// Text has no floor: it can spend every remaining credit.
		expect(
			await port.spend({
				universeId: 'u1',
				kind: 'context_pack',
				subjectEntityId: null,
				credits: 25
			})
		).toBe(true);
		expect(port.spent).toBe(100);

		// The budget is now fully spent - text itself stops only once truly exhausted, not
		// before, and never overspends past the total.
		expect(
			await port.spend({ universeId: 'u1', kind: 'brief', subjectEntityId: null, credits: 1 })
		).toBe(false);
		expect(port.spent).toBe(100);
	});

	it('never lets spend push the total past what was allocated', async () => {
		const port = createInMemoryWarmBudgetPort(10);
		expect(
			await port.spend({ universeId: 'u1', kind: 'brief', subjectEntityId: null, credits: 7 })
		).toBe(true);
		expect(
			await port.spend({ universeId: 'u1', kind: 'brief', subjectEntityId: null, credits: 7 })
		).toBe(false);
		expect(port.spent).toBe(7);
	});
});
