import { describe, expect, it } from 'vitest';
import {
	nameOverlapScore,
	normalizeForMatching,
	oneLineSummary,
	preFilterCandidates,
	resolveMatch,
	type MatchCandidate,
	type PreFilterNarrowing,
	type SimilarityFn
} from './matching.js';

const THRESHOLDS = { matchAbove: 0.8, newBelow: 0.4 };

describe('normalizeForMatching (issue #36/#37)', () => {
	it('lowercases, strips diacritics and collapses punctuation to spaces', () => {
		expect(normalizeForMatching('The Gilded Rat!')).toBe('the gilded rat');
		expect(normalizeForMatching('Il Ratto Dorato')).toBe('il ratto dorato');
		expect(normalizeForMatching('Café-du-Roi')).toBe('cafe du roi');
	});
});

describe('oneLineSummary (issue #310)', () => {
	it('takes the first sentence of a body, which is the one line a candidate contributes', () => {
		expect(
			oneLineSummary(
				'A college of seven towers built into a cliff. Half its library is older than the kingdom.'
			)
		).toBe('A college of seven towers built into a cliff.');
	});

	it('flattens markdown and wikilinks, so a heading does not become the context line', () => {
		// An entity body's first line is very often `## Rivalry` followed by the prose that
		// matters, and a context line reading "##" is worse than no context line.
		expect(
			oneLineSummary('## Rivalry\n\nIts oldest rivalry runs through [[Blackmere College]].')
		).toBe('Rivalry Its oldest rivalry runs through Blackmere College.');
	});

	it('falls back to a hard cut when there is no sentence end inside the budget', () => {
		const summary = oneLineSummary('x'.repeat(400), 50);
		expect(summary).toBe(`${'x'.repeat(50)}...`);
	});

	it('answers null for nothing to summarise, which is a real state and not a defect', () => {
		// A `draft_entity` proposal accepted before anybody wrote its prose has an empty body.
		expect(oneLineSummary('')).toBeNull();
		expect(oneLineSummary('   \n  ')).toBeNull();
		expect(oneLineSummary(null)).toBeNull();
		expect(oneLineSummary(undefined)).toBeNull();
	});
});

describe('nameOverlapScore', () => {
	it('scores shared tokens between differently-worded names for the same thing', () => {
		const score = nameOverlapScore(
			{ name: 'the Gilded Rat', aliases: [] },
			{ id: 'e1', name: 'Gilded Rat Tavern', aliases: [] }
		);
		expect(score).toBeGreaterThan(0);
	});

	it('scores zero for a translated name sharing no token - the case the pre-filter cannot catch', () => {
		const score = nameOverlapScore(
			{ name: 'the Gilded Rat', aliases: [] },
			{ id: 'e1', name: 'Il Ratto Dorato', aliases: [] }
		);
		expect(score).toBe(0);
	});
});

describe('preFilterCandidates', () => {
	it('returns every candidate unchanged when under the limit', () => {
		const candidates: MatchCandidate[] = [{ id: 'a', name: 'A', aliases: [] }];
		expect(preFilterCandidates({ name: 'A', aliases: [] }, candidates, 5)).toEqual(candidates);
	});

	it('narrows to the highest name-overlap candidates when over the limit', () => {
		const candidates: MatchCandidate[] = [
			{ id: 'unrelated-1', name: 'Bramblewood Ferry', aliases: [] },
			{ id: 'unrelated-2', name: 'Thistledown Market', aliases: [] },
			{ id: 'match', name: 'the Gilded Rat', aliases: ['Gilded Rat Tavern'] },
			{ id: 'unrelated-3', name: 'Whispering Cairn', aliases: [] }
		];
		const narrowed = preFilterCandidates({ name: 'Gilded Rat', aliases: [] }, candidates, 1);
		expect(narrowed).toEqual([candidates[2]]);
	});
});

describe('resolveMatch (issue #36/#37)', () => {
	it('short-circuits to an exact match when a source ref already resolved one, without calling similarity', async () => {
		let similarityCalls = 0;
		const similarity: SimilarityFn = () => {
			similarityCalls += 1;
			return 1;
		};
		const decision = await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: { id: 'existing-1', name: 'Aldric Voss', aliases: [] },
			candidates: [{ id: 'existing-1', name: 'Aldric Voss', aliases: [] }],
			similarity,
			thresholds: THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'exact', candidateId: 'existing-1' });
		expect(similarityCalls).toBe(0);
	});

	it('reports a new entity when there are no candidates at all', async () => {
		const decision = await resolveMatch({
			subject: { name: 'Someone New', aliases: [] },
			exactSourceRefMatch: null,
			candidates: [],
			similarity: () => 0,
			thresholds: THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'new' });
	});

	it('matches above the high threshold without asking', async () => {
		const candidate: MatchCandidate = { id: 'e1', name: 'the Gilded Rat', aliases: [] };
		const decision = await resolveMatch({
			subject: { name: 'Gilded Rat Tavern', aliases: [] },
			exactSourceRefMatch: null,
			candidates: [candidate],
			similarity: () => 0.95,
			thresholds: THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'match', candidateId: 'e1', similarity: 0.95 });
	});

	it('reports a new entity below the low threshold without asking', async () => {
		const candidate: MatchCandidate = { id: 'e1', name: 'Someone Else Entirely', aliases: [] };
		const decision = await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates: [candidate],
			similarity: () => 0.1,
			thresholds: THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'new' });
	});

	it('asks, never guesses, for the in-between band - SPEC.md §6.4', async () => {
		const candidate: MatchCandidate = { id: 'e1', name: 'Aldric Voss the Younger', aliases: [] };
		const decision = await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates: [candidate],
			similarity: () => 0.6,
			thresholds: THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'ask', candidateIds: ['e1'], similarity: 0.6 });
	});

	it('collects every in-band candidate for the one batched question, not only the best', async () => {
		const candidates: MatchCandidate[] = [
			{ id: 'e1', name: 'Aldric Voss', aliases: [] },
			{ id: 'e2', name: 'Aldric Vossberg', aliases: [] },
			{ id: 'e3', name: 'Completely Unrelated', aliases: [] }
		];
		const scoreByCandidate: Record<string, number> = { e1: 0.65, e2: 0.55, e3: 0.05 };
		const decision = await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates,
			similarity: (_subject, candidate) => scoreByCandidate[candidate.id] ?? 0,
			thresholds: THRESHOLDS
		});
		expect(decision.outcome).toBe('ask');
		if (decision.outcome === 'ask') {
			expect(decision.candidateIds.sort()).toEqual(['e1', 'e2']);
		}
	});

	it('breaks a near-tie on semantic score using name overlap', async () => {
		const closeCall: MatchCandidate = {
			id: 'overlap-high',
			name: 'Gilded Rat Tavern',
			aliases: []
		};
		const noOverlap: MatchCandidate = { id: 'overlap-low', name: 'Il Ratto Dorato', aliases: [] };
		const decision = await resolveMatch({
			subject: { name: 'the Gilded Rat', aliases: [] },
			exactSourceRefMatch: null,
			candidates: [noOverlap, closeCall],
			similarity: () => 0.9, // identical semantic score for both
			thresholds: THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'match', candidateId: 'overlap-high', similarity: 0.9 });
	});

	it('never sends more than preFilterLimit candidates to the similarity function', async () => {
		const candidates: MatchCandidate[] = Array.from({ length: 50 }, (_, i) => ({
			id: `e${i}`,
			name: `Unrelated Entity ${i}`,
			aliases: []
		}));
		let calls = 0;
		await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates,
			similarity: () => {
				calls += 1;
				return 0.5;
			},
			thresholds: THRESHOLDS,
			preFilterLimit: 5
		});
		expect(calls).toBeLessThanOrEqual(5);
	});

	it('reports what the pre-filter dropped, which is the cap that actually decides (issue #666)', async () => {
		const candidates: MatchCandidate[] = Array.from({ length: 50 }, (_, i) => ({
			id: `e${i}`,
			name: `Unrelated Entity ${i}`,
			aliases: []
		}));
		const narrowing: PreFilterNarrowing[] = [];
		await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates,
			similarity: () => 0.5,
			thresholds: THRESHOLDS,
			preFilterLimit: 5,
			onPreFilter: (n) => narrowing.push(n)
		});
		expect(narrowing).toEqual([{ poolSize: 50, scoredSize: 5 }]);
	});

	it('reports a pool it did not narrow, so a caller can tell "not cut" from "not read"', async () => {
		const narrowing: PreFilterNarrowing[] = [];
		await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates: [{ id: 'e1', name: 'Aldric Voss', aliases: [] }],
			similarity: () => 0.9,
			thresholds: THRESHOLDS,
			onPreFilter: (n) => narrowing.push(n)
		});
		expect(narrowing).toEqual([{ poolSize: 1, scoredSize: 1 }]);
	});

	it('reports nothing when a source ref or an identity collision settled the sighting above it', async () => {
		const candidates: MatchCandidate[] = Array.from({ length: 50 }, (_, i) => ({
			id: `e${i}`,
			name: `Unrelated Entity ${i}`,
			aliases: []
		}));
		const narrowing: PreFilterNarrowing[] = [];
		// Step 1 of SPEC.md §6.4, which never reaches a candidate list at all.
		await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: { id: 'by-source-ref', name: 'Aldric Voss', aliases: [] },
			candidates,
			similarity: () => 0.9,
			thresholds: THRESHOLDS,
			onPreFilter: (n) => narrowing.push(n)
		});
		// And #479's identity guard, which is above the scorer for the same reason.
		await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			identity: {
				subject: { name: 'Aldric Voss', slug: 'aldric-voss' },
				candidates: [{ id: 'e-known', name: 'Aldric Voss', slug: 'aldric-voss', type: 'character' }]
			},
			candidates,
			similarity: () => 0.9,
			thresholds: THRESHOLDS,
			onPreFilter: (n) => narrowing.push(n)
		});
		expect(narrowing).toEqual([]);
	});
});
