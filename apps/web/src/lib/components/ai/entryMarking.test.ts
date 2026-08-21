import { describe, expect, it } from 'vitest';
import { renderMarkdown, type MentionTarget } from '$lib/markdown';
import {
	splitBodyIntoBlocks,
	markedProposalFor,
	renderChangeBar,
	type MarkedProposalRef
} from './entryMarking';

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

describe('markedProposalFor', () => {
	it('returns null when nothing in the block is a changed sentence', () => {
		const blocks = splitBodyIntoBlocks('Three hundred and forty sworn, paid badly.');
		expect(markedProposalFor(blocks[0]!, new Map())).toBeNull();
	});

	it('returns the proposal targeting the block, leaving an unmarked block alone', () => {
		const blocks = splitBodyIntoBlocks(
			'Captain of the Valdoria Watch, forty sworn under him.\n\nHe drinks at the Gilded Rat most nights.'
		);
		const ref: MarkedProposalRef = { proposalId: 'p1', planId: 'plan1' };
		const changed = new Map([['Captain of the Valdoria Watch, forty sworn under him.', ref]]);
		expect(markedProposalFor(blocks[0]!, changed)).toEqual(ref);
		expect(markedProposalFor(blocks[1]!, changed)).toBeNull();
	});

	it('matches a changed heading too, matching how semanticDiff treats a heading as its own unit', () => {
		const blocks = splitBodyIntoBlocks('## Standing in the city');
		const ref: MarkedProposalRef = { proposalId: 'p1', planId: null };
		expect(markedProposalFor(blocks[0]!, new Map([['## Standing in the city', ref]]))).toEqual(ref);
	});

	it("keeps the block's mention syntax untouched - matching happens on the raw sentence, never a stripped copy", () => {
		const blocks = splitBodyIntoBlocks('He now answers to [[The Ashen Ledger]].');
		const ref: MarkedProposalRef = { proposalId: 'p1', planId: null };
		const changed = new Map([['He now answers to [[The Ashen Ledger]].', ref]]);
		expect(markedProposalFor(blocks[0]!, changed)).toEqual(ref);
	});
});

describe('renderChangeBar', () => {
	it('wraps the given HTML with a keyboard-reachable link carrying the accessible name', () => {
		const html = renderChangeBar(
			'<p>Some prose.</p>',
			'/w/valdoria-reach/proposals/plan1',
			'A proposal is waiting on this passage.'
		);
		expect(html).toContain('<p>Some prose.</p>');
		expect(html).toContain('<a class="ai-change-bar"');
		expect(html).toContain('href="/w/valdoria-reach/proposals/plan1"');
		expect(html).toContain('aria-label="A proposal is waiting on this passage."');
	});

	it('escapes the href and label as attribute values, never as a claim about who wrote the prose', () => {
		const html = renderChangeBar('<p>x</p>', '/w/a"b', 'Waiting <here>');
		expect(html).toContain('href="/w/a&quot;b"');
		expect(html).toContain('aria-label="Waiting &lt;here&gt;"');
	});
});

describe('a marked block, rendered end to end (#499: the second cost)', () => {
	it("still resolves the block's own mentions to links - the change bar never runs prose through an escaper", () => {
		const mentionTargets: MentionTarget[] = [
			{ name: 'The Ashen Ledger', slug: 'the-ashen-ledger', aliases: [] }
		];
		const body = 'He now answers to [[The Ashen Ledger]], and the harbour has noticed.';
		const blocks = splitBodyIntoBlocks(body);
		const ref: MarkedProposalRef = { proposalId: 'p1', planId: null };
		const changed = new Map([[body, ref]]);

		const block = blocks[0]!;
		const rendered = renderMarkdown(block.raw, 'valdoria-reach', mentionTargets, 'gm');
		const proposal = markedProposalFor(block, changed);
		const html = proposal
			? renderChangeBar(rendered, '/w/valdoria-reach/proposals', 'Waiting')
			: rendered;

		expect(proposal).toEqual(ref);
		expect(html).toContain('class="mention"');
		expect(html).toContain('data-entry-slug="the-ashen-ledger"');
		expect(html).not.toContain('[[The Ashen Ledger]]');
	});
});
