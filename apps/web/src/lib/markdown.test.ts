import { describe, expect, it } from 'vitest';
import {
	clampImageWidthPercent,
	imageUrlsIn,
	matchImageToken,
	mentionPreviewExcerpt,
	normalizeMentions,
	renderMarkdown,
	renderMarkdownWithHighlight,
	resolveMentionName,
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
			TARGETS,
			'gm'
		);
		expect(html).toContain(
			'<a href="/w/valdoria-reach/e/the-ashen-ledger" class="mention" data-entry-slug="the-ashen-ledger">The Ashen Ledger</a>'
		);
	});

	it('renders an unresolved mention as visibly unresolved, never as a dead link', () => {
		const html = renderMarkdown(
			'He drinks at [[The Rusty Anchor]].',
			'valdoria-reach',
			TARGETS,
			'gm'
		);
		expect(html).toContain('class="mention mention-unresolved"');
		expect(html).not.toContain('<a');
		expect(html).toContain('The Rusty Anchor');
	});

	it('resolves an alias to the entity that owns it, not a separate one', () => {
		const html = renderMarkdown(
			'He still drinks at [[Il Ratto Dorato]].',
			'valdoria-reach',
			TARGETS,
			'gm'
		);
		expect(html).toContain(
			'<a href="/w/valdoria-reach/e/the-gilded-rat" class="mention" data-entry-slug="the-gilded-rat">Il Ratto Dorato</a>'
		);
	});

	it('escapes raw HTML in the source instead of trusting it', () => {
		const html = renderMarkdown(
			'Watch out: <script>alert(1)</script>',
			'valdoria-reach',
			TARGETS,
			'gm'
		);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});
});

describe('mention hrefs by surface (#159)', () => {
	// `TARGETS` stands in for `publicMentionTargets`'s result on the real `/p/**` route: a
	// target only ever appears there when it is public (visibility != gm_only - see
	// `packages/db/test/players.test.ts`'s own test on that query). A name whose entity
	// exists but is not public is never in the targets list at all, which is what the
	// second case below stands in for by naming something outside `TARGETS`.
	it('links a published target to the public entry page, never the GM route', () => {
		const html = renderMarkdown(
			'He answers to [[The Ashen Ledger]] now.',
			'valdoria-reach',
			TARGETS,
			'public'
		);
		expect(html).toContain(
			'<a href="/p/valdoria-reach/the-ashen-ledger" class="mention" data-entry-slug="the-ashen-ledger">The Ashen Ledger</a>'
		);
		expect(html).not.toContain('/w/valdoria-reach/e/the-ashen-ledger');
	});

	it('renders a mention of a name outside the public target list as plain unresolved text, no href', () => {
		const html = renderMarkdown(
			'The watch never speaks of [[The Umbral Concord]].',
			'valdoria-reach',
			TARGETS,
			'public'
		);
		expect(html).toContain('class="mention mention-unresolved"');
		expect(html).not.toContain('<a');
		expect(html).not.toContain('href');
		expect(html).toContain('The Umbral Concord');
	});

	it('still links to the GM route on the gm surface', () => {
		const html = renderMarkdown(
			'He answers to [[The Ashen Ledger]] now.',
			'valdoria-reach',
			TARGETS,
			'gm'
		);
		expect(html).toContain(
			'<a href="/w/valdoria-reach/e/the-ashen-ledger" class="mention" data-entry-slug="the-ashen-ledger">The Ashen Ledger</a>'
		);
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
		const html = renderMarkdownWithHighlight(
			body,
			'valdoria-reach',
			[],
			{ start, end: start + evidence.length },
			'gm'
		);
		expect(html).toContain(`<mark class="factspan">${evidence}</mark>`);
	});

	it('still renders the rest of the document around the highlight', () => {
		const start = body.indexOf(evidence);
		const html = renderMarkdownWithHighlight(
			body,
			'valdoria-reach',
			[],
			{ start, end: start + evidence.length },
			'gm'
		);
		expect(html).toContain('<h2>Standing in the city</h2>');
		expect(html).toContain('Three hundred and forty sworn used to take his word.');
	});

	it('falls back to a plain render when the span does not land in a single paragraph', () => {
		const html = renderMarkdownWithHighlight(
			body,
			'valdoria-reach',
			[],
			{ start: 0, end: body.length },
			'gm'
		);
		expect(html).toBe(renderMarkdown(body, 'valdoria-reach', [], 'gm'));
	});
});

/**
 * #364, the half of the issue that is about guardrail 6 rather than about a tooltip. A
 * preview is a second way to read an entry, and #355 is open because a quoted slice can
 * carry a fenced sentence, so these assert the excerpt against the fixture world's own
 * shape: The Ashen Ledger carries both a `:::secret` and a `:::gmnote` fence.
 *
 * The needles are the fenced sentences themselves and the markers around them. A future
 * refactor that reached for `body.slice(0, 200)` because it is faster would pass every
 * other test in this file and fail these.
 */
describe('mentionPreviewExcerpt (#364)', () => {
	const FENCED_BODY = [
		'A merchant bank that lends at knife point.',
		'',
		':::secret',
		'Aldric Vane is on the Ledger payroll.',
		':::',
		'',
		':::gmnote',
		'GM only: play this as her fault circling back.',
		':::',
		'',
		'Its writ runs the length of the Lantern Quarter.'
	].join('\n');

	it('never carries a sentence from inside a secret or a GM note fence', () => {
		const excerpt = mentionPreviewExcerpt(FENCED_BODY);
		expect(excerpt).not.toContain('Aldric Vane is on the Ledger payroll');
		expect(excerpt).not.toContain('play this as her fault circling back');
		expect(excerpt).toContain('A merchant bank that lends at knife point.');
		expect(excerpt).toContain('Its writ runs the length of the Lantern Quarter.');
	});

	it('never carries a fence marker, which would say there is something hidden here', () => {
		expect(mentionPreviewExcerpt(FENCED_BODY)).not.toContain(':::');
	});

	it('fails closed on an unclosed fence, hiding the rest of the body with it', () => {
		const excerpt = mentionPreviewExcerpt(
			['The public opening.', '', ':::secret', 'Everything after a typo stays hidden.'].join('\n')
		);
		expect(excerpt).toBe('The public opening.');
	});

	it('withholds everything when the whole body is fenced', () => {
		expect(mentionPreviewExcerpt([':::secret', 'All of it is a secret.', ':::'].join('\n'))).toBe(
			''
		);
	});

	it('reads as prose, not as markup: no heading marks, bullets, emphasis or image refs', () => {
		const excerpt = mentionPreviewExcerpt(
			[
				'## The Ledger',
				'',
				'![a portrait](/w/valdoria-reach/e/the-ashen-ledger/media/abc)',
				'',
				'- **Founded** in the year of the _long rain_',
				'- Holds the debt of [the Quarter](/p/valdoria-reach/lantern-quarter)',
				'',
				'> They lend at knife point.'
			].join('\n')
		);
		expect(excerpt).toBe(
			'The Ledger Founded in the year of the long rain Holds the debt of the Quarter They lend at knife point.'
		);
	});

	it('shows a mention as the name it reads as, not as its brackets', () => {
		expect(mentionPreviewExcerpt('Sworn to [[The Ashen Ledger]] since the siege.')).toBe(
			'Sworn to The Ashen Ledger since the siege.'
		);
	});

	it('cuts on a word boundary and says it cut', () => {
		const excerpt = mentionPreviewExcerpt('one two three four five six seven', 20);
		expect(excerpt).toBe('one two three four\u2026');
	});

	it('leaves a body shorter than the limit whole, with no ellipsis', () => {
		expect(mentionPreviewExcerpt('Short enough.', 20)).toBe('Short enough.');
	});

	it('is empty for an entry nobody has written yet', () => {
		expect(mentionPreviewExcerpt('')).toBe('');
		expect(mentionPreviewExcerpt('   \n\n  ')).toBe('');
	});
});

describe('sized images (R9, #384)', () => {
	it.each([
		['a third', '=33%', 'width:33%'],
		['two thirds', '=67%', 'width:67%'],
		['full', '=100%', 'width:100%']
	])('parses %s as a width on the <img>', (_label, suffix, style) => {
		const html = renderMarkdown(`![A cat](/w/w1/e/rat/media/a1 ${suffix})`, 'w1', [], 'gm');
		expect(html).toContain(`<img src="/w/w1/e/rat/media/a1" alt="A cat" style="${style}">`);
	});

	it('renders an image with no size suffix exactly as before - no style attribute', () => {
		const html = renderMarkdown('![A cat](/w/w1/e/rat/media/a1)', 'w1', [], 'gm');
		expect(html).toContain('<img src="/w/w1/e/rat/media/a1" alt="A cat">');
		expect(html).not.toContain('style=');
	});

	it.each([
		['a pixel unit', '=50px'],
		['no unit at all', '=50'],
		['a non-numeric value', '=abc%'],
		['a bare equals sign', '=']
	])('leaves a malformed suffix (%s) inert rather than a broken link', (_label, suffix) => {
		const source = `![A cat](/w/w1/e/rat/media/a1 ${suffix})`;
		const html = renderMarkdown(source, 'w1', [], 'gm');
		// Not recognised as an image at all - markdown-it's own `image` rule fails to
		// close the paren either, so the literal source reappears as plain text, exactly
		// as it would have before this syntax existed.
		expect(html).not.toContain('<img');
		expect(html).toContain('/w/w1/e/rat/media/a1');
	});

	it('clamps a percentage above 100 down to the maximum', () => {
		const html = renderMarkdown('![A cat](/w/w1/e/rat/media/a1 =250%)', 'w1', [], 'gm');
		expect(html).toContain('style="width:100%"');
	});

	it('clamps a percentage of 0 up to the minimum rather than collapsing the image', () => {
		const html = renderMarkdown('![A cat](/w/w1/e/rat/media/a1 =0%)', 'w1', [], 'gm');
		expect(html).toContain('style="width:1%"');
	});
});

describe('matchImageToken', () => {
	it('returns null with no width suffix and null widthPercent, distinct from malformed', () => {
		const match = matchImageToken('![A cat](/media/1)', 0);
		expect(match).toEqual({ end: 18, alt: 'A cat', url: '/media/1', widthPercent: null });
	});

	it('returns null for a malformed suffix rather than throwing', () => {
		expect(matchImageToken('![A cat](/media/1 =50px)', 0)).toBeNull();
	});

	it('returns null when the string at `start` is not an image at all', () => {
		expect(matchImageToken('Not an image.', 0)).toBeNull();
	});
});

describe('clampImageWidthPercent', () => {
	it('leaves an in-range value alone', () => {
		expect(clampImageWidthPercent(67)).toBe(67);
	});

	it('clamps above the maximum', () => {
		expect(clampImageWidthPercent(500)).toBe(100);
	});

	it('clamps at or below zero up to the minimum', () => {
		expect(clampImageWidthPercent(0)).toBe(1);
		expect(clampImageWidthPercent(-40)).toBe(1);
	});
});

describe('imageUrlsIn (#385)', () => {
	it('returns every image URL in document order, sized or not', () => {
		const source = [
			'Some prose first.',
			'![alt one](/w/w1/e/rat/media/a1)',
			'More prose in between.',
			'![alt two](/w/w1/e/rat/media/a2 =50%)'
		].join('\n\n');
		expect(imageUrlsIn(source)).toEqual(['/w/w1/e/rat/media/a1', '/w/w1/e/rat/media/a2']);
	});

	it('returns an empty array for a body with no images', () => {
		expect(imageUrlsIn('Just prose, [[a mention]], and a [link](https://example.test).')).toEqual(
			[]
		);
	});

	it('ignores a bare "!" that starts no image token', () => {
		expect(imageUrlsIn('Wait! Is that [[The Gilded Rat]]?')).toEqual([]);
	});

	it('finds the same image twice if the body references it twice', () => {
		const source = '![first](/w/w1/e/rat/media/a1) and again ![second](/w/w1/e/rat/media/a1 =33%)';
		expect(imageUrlsIn(source)).toEqual(['/w/w1/e/rat/media/a1', '/w/w1/e/rat/media/a1']);
	});
});
