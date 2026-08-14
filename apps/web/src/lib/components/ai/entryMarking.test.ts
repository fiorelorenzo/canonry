import { describe, expect, it } from 'vitest';
import { splitBodyIntoBlocks, markedSegmentsFor } from './entryMarking';

describe('splitBodyIntoBlocks', () => {
	it('splits on blank lines, one block per paragraph', () => {
		const blocks = splitBodyIntoBlocks('First paragraph.\n\nSecond paragraph.');
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.raw).toBe('First paragraph.');
		expect(blocks[1]?.raw).toBe('Second paragraph.');
	});

	it('gives a heading its own block, never merged with the paragraph around it', () => {
		const blocks = splitBodyIntoBlocks('## Standing in the city\nSome prose after it.');
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.raw).toBe('## Standing in the city');
		expect(blocks[0]?.sentences).toEqual(['## Standing in the city']);
		expect(blocks[1]?.raw).toBe('Some prose after it.');
	});

	it('joins a wrapped paragraph across lines into one sentence stream, matching semanticDiff', () => {
		const blocks = splitBodyIntoBlocks(
			'Captain of the Valdoria Watch,\nforty sworn under him. He drinks at the Gilded Rat.'
		);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.sentences).toEqual([
			'Captain of the Valdoria Watch, forty sworn under him.',
			'He drinks at the Gilded Rat.'
		]);
	});

	it('keeps the raw multi-line text intact for normal rendering even when sentences are normalised', () => {
		const blocks = splitBodyIntoBlocks('Line one\nline two.');
		expect(blocks[0]?.raw).toBe('Line one\nline two.');
	});
});

describe('markedSegmentsFor', () => {
	it('returns null when nothing in the block is a changed sentence', () => {
		const blocks = splitBodyIntoBlocks('Three hundred and forty sworn, paid badly.');
		expect(markedSegmentsFor(blocks[0]!, new Set(['some other sentence']))).toBeNull();
	});

	it('marks exactly the sentence a proposal changed, leaving the rest of the paragraph unmarked', () => {
		const blocks = splitBodyIntoBlocks(
			'Captain of the Valdoria Watch, forty sworn under him. He drinks at the Gilded Rat most nights.'
		);
		const segments = markedSegmentsFor(
			blocks[0]!,
			new Set(['Captain of the Valdoria Watch, forty sworn under him.'])
		);
		expect(segments).toEqual([
			{ text: 'Captain of the Valdoria Watch, forty sworn under him.', proposed: true },
			{ text: 'He drinks at the Gilded Rat most nights.', proposed: false }
		]);
	});

	it('strips mention syntax to a bare name rather than leaking [[brackets]] into the marked text', () => {
		const blocks = splitBodyIntoBlocks('He now answers to [[The Ashen Ledger]].');
		const segments = markedSegmentsFor(
			blocks[0]!,
			new Set(['He now answers to [[The Ashen Ledger]].'])
		);
		expect(segments?.[0]?.text).toBe('He now answers to The Ashen Ledger.');
	});

	it('marks a changed heading too, matching how semanticDiff treats a heading as its own unit', () => {
		const blocks = splitBodyIntoBlocks('## Standing in the city');
		const segments = markedSegmentsFor(blocks[0]!, new Set(['## Standing in the city']));
		expect(segments).toEqual([{ text: '## Standing in the city', proposed: true }]);
	});
});
