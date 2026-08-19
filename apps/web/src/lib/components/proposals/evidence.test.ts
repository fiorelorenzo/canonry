import { describe, expect, it } from 'vitest';
import { normalizeEvidence } from './evidence';

describe('normalizeEvidence', () => {
	it('describes a relation candidate with hop count and path, never a bare score', () => {
		const { views, caveat } = normalizeEvidence('save', [
			{ kind: 'relation', hops: 1, path: ['commands'] }
		]);
		expect(views).toEqual([
			{ quote: null, reason: { kind: 'relation', path: ['commands'], hops: 1 } }
		]);
		expect(caveat).toBeNull();
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
		const { views, caveat } = normalizeEvidence('save', [
			{ kind: 'embedding', similarity: 0.81, sourceSentence: 'felt the same thaw' }
		]);
		expect(caveat).toBe('embeddingOnly');
		// Structured, not a formatted sentence - never a bare confidence number in the reason.
		expect(views[0]?.reason).toEqual({ kind: 'embedding' });
	});

	it('does not force evidence open when a relation or mention backs the same candidate too', () => {
		const { caveat } = normalizeEvidence('save', [
			{ kind: 'relation', hops: 2, path: ['commands', 'protects'] },
			{ kind: 'embedding', similarity: 0.6, sourceSentence: 'x' }
		]);
		expect(caveat).toBeNull();
	});

	it('quotes the GM\u2019s own request for an Ask proposal, and says that is all that backs it (issue #270)', () => {
		const { views, caveat } = normalizeEvidence('ask', [
			{ kind: 'instruction', instruction: 'crea una scheda per il nipote di Mother Sennah' }
		]);
		expect(views).toEqual([
			{
				quote: 'crea una scheda per il nipote di Mother Sennah',
				reason: { kind: 'instruction' }
			}
		]);
		// Not 'embeddingOnly': a header reading "embedding similarity only" over the GM's own
		// sentence would be its own small lie.
		expect(caveat).toBe('instructionOnly');
	});

	it('still says instructionOnly when a weak retrieved sentence rides along beside the request', () => {
		const { views, caveat } = normalizeEvidence('ask', [
			{ kind: 'instruction', instruction: 'her nephew runs the stables' },
			{ kind: 'embedding', similarity: 0.105, sourceSentence: 'Keeps [[The Gilded Rat]].' }
		]);
		expect(views.map((v) => v.reason.kind)).toEqual(['instruction', 'embedding']);
		expect(caveat).toBe('instructionOnly');
	});

	it('describes a clean import extraction as new, with the source document path', () => {
		const { views, caveat } = normalizeEvidence('import', {
			documentId: 'doc-1',
			sourceRef: { documentId: 'doc-1', path: 'places/sable-reach.md' },
			evidenceSpan: { start: 0, end: 10 },
			similarity: null,
			ambiguousCandidateIds: []
		});
		expect(views).toEqual([
			{ quote: null, reason: { kind: 'importExtracted', path: 'places/sable-reach.md' } }
		]);
		expect(caveat).toBeNull();
	});

	it('marks an ambiguous import match as forced-open weak evidence', () => {
		const { caveat, views } = normalizeEvidence('import', {
			sourceRef: { path: 'characters/aldric.md' },
			similarity: 0.7,
			ambiguousCandidateIds: ['a', 'b']
		});
		expect(caveat).toBe('embeddingOnly');
		expect(views[0]?.reason).toEqual({
			kind: 'importAmbiguous',
			path: 'characters/aldric.md',
			count: 2
		});
	});

	it('returns nothing for unrecognised evidence rather than guessing', () => {
		expect(normalizeEvidence('save', null)).toEqual({ views: [], caveat: null });
		expect(normalizeEvidence('save', 'not an array')).toEqual({ views: [], caveat: null });
	});
});
