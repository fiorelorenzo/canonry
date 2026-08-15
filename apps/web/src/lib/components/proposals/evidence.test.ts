import { describe, expect, it } from 'vitest';
import { normalizeEvidence } from './evidence';

describe('normalizeEvidence', () => {
	it('describes a relation candidate with hop count and path, never a bare score', () => {
		const { views, forceOpen } = normalizeEvidence('save', [
			{ kind: 'relation', hops: 1, path: ['commands'] }
		]);
		expect(views).toEqual([
			{ quote: null, reason: { kind: 'relation', path: ['commands'], hops: 1 } }
		]);
		expect(forceOpen).toBe(false);
	});

	it('quotes the source sentence for a mention candidate', () => {
		const { views } = normalizeEvidence('save', [
			{
				kind: 'mention',
				direction: 'forward',
				matchedText: 'the watch',
				sourceSentence: 'the watch is his to command'
			}
		]);
		expect(views).toEqual([
			{
				quote: 'the watch is his to command',
				reason: { kind: 'mention', direction: 'forward', matchedText: 'the watch' }
			}
		]);
	});

	it('forces evidence open when the only channel is embedding similarity (guardrail 3)', () => {
		const { views, forceOpen } = normalizeEvidence('save', [
			{ kind: 'embedding', similarity: 0.81, sourceSentence: 'felt the same thaw' }
		]);
		expect(forceOpen).toBe(true);
		// Structured, not a formatted sentence - never a bare confidence number in the reason.
		expect(views[0]?.reason).toEqual({ kind: 'embedding' });
	});

	it('does not force evidence open when a relation or mention backs the same candidate too', () => {
		const { forceOpen } = normalizeEvidence('save', [
			{ kind: 'relation', hops: 2, path: ['commands', 'protects'] },
			{ kind: 'embedding', similarity: 0.6, sourceSentence: 'x' }
		]);
		expect(forceOpen).toBe(false);
	});

	it('describes a clean import extraction as new, with the source document path', () => {
		const { views, forceOpen } = normalizeEvidence('import', {
			documentId: 'doc-1',
			sourceRef: { documentId: 'doc-1', path: 'places/sable-reach.md' },
			evidenceSpan: { start: 0, end: 10 },
			similarity: null,
			ambiguousCandidateIds: []
		});
		expect(views).toEqual([
			{ quote: null, reason: { kind: 'importExtracted', path: 'places/sable-reach.md' } }
		]);
		expect(forceOpen).toBe(false);
	});

	it('marks an ambiguous import match as forced-open weak evidence', () => {
		const { forceOpen, views } = normalizeEvidence('import', {
			sourceRef: { path: 'characters/aldric.md' },
			similarity: 0.7,
			ambiguousCandidateIds: ['a', 'b']
		});
		expect(forceOpen).toBe(true);
		expect(views[0]?.reason).toEqual({
			kind: 'importAmbiguous',
			path: 'characters/aldric.md',
			count: 2
		});
	});

	it('returns nothing for unrecognised evidence rather than guessing', () => {
		expect(normalizeEvidence('save', null)).toEqual({ views: [], forceOpen: false });
		expect(normalizeEvidence('save', 'not an array')).toEqual({ views: [], forceOpen: false });
	});
});
