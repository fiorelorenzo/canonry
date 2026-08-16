import { describe, expect, it } from 'vitest';
import type { CandidateEntry } from './candidates.js';
import {
	effectiveCap,
	normalizeReason,
	rejectPenaltyFor,
	scoreCandidates,
	type RejectionRecord
} from './reject-signal.js';

function candidate(entityId: string, score: number, relationKeys: string[] = []): CandidateEntry {
	return {
		entityId,
		score,
		evidence: relationKeys.map((key) => ({ kind: 'relation' as const, hops: 1, path: [key] }))
	};
}

describe('normalizeReason', () => {
	it('maps the five fixed chips case-insensitively', () => {
		expect(normalizeReason('Wrong')).toBe('wrong');
		expect(normalizeReason('already true')).toBe('already_true');
		expect(normalizeReason('not canon yet')).toBe('not_canon_yet');
		expect(normalizeReason('too much')).toBe('too_much');
		expect(normalizeReason('prose')).toBe('prose');
	});

	it('falls back to other for free text and for no reason at all', () => {
		expect(normalizeReason('this NPC already died last session')).toBe('other');
		expect(normalizeReason(null)).toBe('other');
		expect(normalizeReason(undefined)).toBe('other');
	});
});

describe('rejectPenaltyFor and scoreCandidates', () => {
	it('a candidate resembling a previously rejected one ranks lower than an equally-scored peer with no history', () => {
		// Two candidates found the same way (one hop-1 relation, equal base score).
		const resemblesRejected = candidate('corvin-ashe', 1, ['employs']);
		const noHistory = candidate('the-valdoria-watch', 1, ['member_of']);

		const history: RejectionRecord[] = [
			{ targetEntityId: 'some-other-entity', relationKeys: ['employs'], reason: 'wrong' }
		];

		const ranked = scoreCandidates([resemblesRejected, noHistory], history);
		expect(ranked.map((c) => c.entityId)).toEqual(['the-valdoria-watch', 'corvin-ashe']);
		expect(ranked[0]!.finalScore).toBeGreaterThan(ranked[1]!.finalScore);
	});

	it('the exact same entity rejected before scores lower than one that only resembles it', () => {
		const exactMatch = candidate('corvin-ashe', 1, ['employs']);
		const resemblesOnly = candidate('another-employee', 1, ['employs']);
		const history: RejectionRecord[] = [
			{ targetEntityId: 'corvin-ashe', relationKeys: ['employs'], reason: 'wrong' }
		];

		const ranked = scoreCandidates([exactMatch, resemblesOnly], history);
		expect(ranked.map((c) => c.entityId)).toEqual(['another-employee', 'corvin-ashe']);
	});

	it('a candidate with no resemblance at all is unaffected', () => {
		const unrelated = candidate('cairnmouth', 1, ['starved_in']);
		const history: RejectionRecord[] = [
			{ targetEntityId: 'corvin-ashe', relationKeys: ['employs'], reason: 'wrong' }
		];
		expect(rejectPenaltyFor(unrelated, history)).toBe(0);
	});

	it('"already true" carries the same strong penalty as "wrong"', () => {
		const target = candidate('corvin-ashe', 1);
		const history: RejectionRecord[] = [
			{ targetEntityId: 'corvin-ashe', relationKeys: [], reason: 'already true' }
		];
		expect(rejectPenaltyFor(target, history)).toBe(-1);
	});

	it('"prose" and "not canon yet" carry no ranking weight', () => {
		const target = candidate('corvin-ashe', 1);
		expect(
			rejectPenaltyFor(target, [
				{ targetEntityId: 'corvin-ashe', relationKeys: [], reason: 'prose' }
			])
		).toBe(0);
		expect(
			rejectPenaltyFor(target, [
				{ targetEntityId: 'corvin-ashe', relationKeys: [], reason: 'not canon yet' }
			])
		).toBe(0);
	});

	it('free-text "other" reasons carry no ranking weight', () => {
		const target = candidate('corvin-ashe', 1);
		expect(
			rejectPenaltyFor(target, [
				{ targetEntityId: 'corvin-ashe', relationKeys: [], reason: 'this happened off-screen' }
			])
		).toBe(0);
	});

	it('penalties from multiple matching rejections accumulate', () => {
		const target = candidate('corvin-ashe', 1);
		const history: RejectionRecord[] = [
			{ targetEntityId: 'corvin-ashe', relationKeys: [], reason: 'wrong' },
			{ targetEntityId: 'corvin-ashe', relationKeys: [], reason: 'wrong' }
		];
		expect(rejectPenaltyFor(target, history)).toBe(-2);
	});
});

describe('effectiveCap', () => {
	it('returns the base cap when there is no "too much" history', () => {
		expect(effectiveCap(10, [])).toBe(10);
		expect(effectiveCap(10, ['wrong', 'already true', null])).toBe(10);
	});

	it('tightens the cap by one per recent "too much"', () => {
		expect(effectiveCap(10, ['too much', 'too much', 'too much'])).toBe(7);
	});

	it('never drops the cap below the floor of 3', () => {
		const many = new Array(20).fill('too much');
		expect(effectiveCap(10, many)).toBe(3);
	});
});
