import { describe, expect, it } from 'vitest';
import {
	normalizeMentions,
	renderMarkdown,
	renderMarkdownWithHighlight,
	resolveMentionName,
	stripMentionSyntax,
	type MentionTarget
} from './markdown';

const TARGETS: MentionTarget[] = [
	{ name: 'The Ashen Ledger', slug: 'the-ashen-ledger', aliases: [] },
	{
		name: 'The Gilded Rat',
		slug: 'the-gilded-rat',
		aliases: ['Gilded Rat Tavern', 'Il Ratto Dorato']
	}
];

describe('renderMarkdown mentions', () => {
	it('links a resolved mention to the entity it names', () => {
		const html = renderMarkdown(
			'He answers to [[The Ashen Ledger]] now.',
			'valdoria-reach',
			TARGETS
		);
		expect(html).toContain(
			'<a href="/w/valdoria-reach/e/the-ashen-ledger" class="mention">The Ashen Ledger</a>'
		);
	});

	it('renders an unresolved mention as visibly unresolved, never as a dead link', () => {
		const html = renderMarkdown('He drinks at [[The Rusty Anchor]].', 'valdoria-reach', TARGETS);
		expect(html).toContain('class="mention mention-unresolved"');
		expect(html).not.toContain('<a');
		expect(html).toContain('The Rusty Anchor');
	});

	it('resolves an alias to the entity that owns it, not a separate one', () => {
		const html = renderMarkdown(
			'He still drinks at [[Il Ratto Dorato]].',
			'valdoria-reach',
			TARGETS
		);
		expect(html).toContain(
			'<a href="/w/valdoria-reach/e/the-gilded-rat" class="mention">Il Ratto Dorato</a>'
		);
	});

	it('escapes raw HTML in the source instead of trusting it', () => {
		const html = renderMarkdown('Watch out: <script>alert(1)</script>', 'valdoria-reach', TARGETS);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});
});

describe('resolveMentionName', () => {
	it('matches case-insensitively on the canonical name', () => {
		expect(resolveMentionName('the ashen ledger', TARGETS)?.slug).toBe('the-ashen-ledger');
	});

	it('matches case-insensitively on an alias', () => {
		expect(resolveMentionName('gilded rat tavern', TARGETS)?.slug).toBe('the-gilded-rat');
	});

	it('returns undefined for a name nothing owns', () => {
		expect(resolveMentionName('Nobody Here', TARGETS)).toBeUndefined();
	});
});

describe('normalizeMentions', () => {
	it('rewrites an alias mention to the canonical name', () => {
		expect(normalizeMentions('He drinks at [[Il Ratto Dorato]].', TARGETS)).toBe(
			'He drinks at [[The Gilded Rat]].'
		);
	});

	it('leaves an unresolved mention exactly as typed', () => {
		expect(normalizeMentions('He drinks at [[The Rusty Anchor]].', TARGETS)).toBe(
			'He drinks at [[The Rusty Anchor]].'
		);
	});

	it('leaves an already-canonical mention unchanged', () => {
		expect(normalizeMentions('[[The Ashen Ledger]] again.', TARGETS)).toBe(
			'[[The Ashen Ledger]] again.'
		);
	});
});

describe('renderMarkdownWithHighlight', () => {
	const body =
		'Dismissed from the watch in the thaw after the Sable Winter, he now answers to the Ashen Ledger.\n\n## Standing in the city\n\nThree hundred and forty sworn used to take his word.';
	const evidence = 'Dismissed from the watch in the thaw after the Sable Winter';

	it('wraps the exact span in a <mark class="factspan">', () => {
		const start = body.indexOf(evidence);
		const html = renderMarkdownWithHighlight(body, 'valdoria-reach', [], {
			start,
			end: start + evidence.length
		});
		expect(html).toContain(`<mark class="factspan">${evidence}</mark>`);
	});

	it('still renders the rest of the document around the highlight', () => {
		const start = body.indexOf(evidence);
		const html = renderMarkdownWithHighlight(body, 'valdoria-reach', [], {
			start,
			end: start + evidence.length
		});
		expect(html).toContain('<h2>Standing in the city</h2>');
		expect(html).toContain('Three hundred and forty sworn used to take his word.');
	});

	it('falls back to a plain render when the span does not land in a single paragraph', () => {
		const html = renderMarkdownWithHighlight(body, 'valdoria-reach', [], {
			start: 0,
			end: body.length
		});
		expect(html).toBe(renderMarkdown(body, 'valdoria-reach', []));
	});
});

describe('stripMentionSyntax', () => {
	it('reduces a mention to its bare name for a display excerpt', () => {
		expect(stripMentionSyntax('after [[The Sable Winter]]')).toBe('after The Sable Winter');
	});

	it('leaves text with no mention syntax unchanged', () => {
		expect(stripMentionSyntax('plain prose only')).toBe('plain prose only');
	});

	it('strips every mention in a span that quotes more than one', () => {
		expect(stripMentionSyntax('[[Aldric Vane]] and [[The Ashen Ledger]]')).toBe(
			'Aldric Vane and The Ashen Ledger'
		);
	});
});
