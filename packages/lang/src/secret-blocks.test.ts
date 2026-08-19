import { describe, expect, it } from 'vitest';
import { isPlayerVisibleSpan, splitSecretBlocks, stripSecretsForPlayers } from './secret-blocks.js';

describe('splitSecretBlocks', () => {
	it('keeps plain prose as a single body segment when there are no fences', () => {
		const source = 'Just some prose.\n\nA second paragraph.';
		expect(splitSecretBlocks(source)).toEqual([
			{ kind: 'body', text: source, start: 0, end: source.length }
		]);
	});

	it('splits a secret block out from the surrounding prose, in order', () => {
		const source = [
			'Public sentence one.',
			'',
			':::secret',
			'Aldric works for the Ledger.',
			':::',
			'',
			'Public sentence two.'
		].join('\n');

		const segments = splitSecretBlocks(source);
		expect(segments.map((s) => s.kind)).toEqual(['body', 'secret', 'body']);
		expect(segments[1]).toMatchObject({ kind: 'secret', text: 'Aldric works for the Ledger.' });
	});

	it('splits a gmnote block distinctly from a secret block', () => {
		const source = [':::gmnote', 'Never shown to players.', ':::'].join('\n');
		expect(splitSecretBlocks(source)).toMatchObject([
			{ kind: 'gmnote', text: 'Never shown to players.' }
		]);
	});

	it('handles a secret containing multiple lines and blank lines', () => {
		const source = [':::secret', 'Line one.', '', 'Line two.', ':::'].join('\n');
		expect(splitSecretBlocks(source)).toMatchObject([
			{ kind: 'secret', text: 'Line one.\n\nLine two.' }
		]);
	});

	it('fails closed on an unclosed fence: everything after it stays hidden, not visible', () => {
		const source = ['Visible intro.', '', ':::secret', 'Never meant to leave the fence.'].join(
			'\n'
		);
		const segments = splitSecretBlocks(source);
		expect(segments).toMatchObject([
			{ kind: 'body', text: 'Visible intro.\n' },
			{ kind: 'secret', text: 'Never meant to leave the fence.' }
		]);
	});

	it('does not treat a fence marker written mid-sentence as an opener', () => {
		const source = 'The colon syntax is written as :::secret inline, not on its own line.';
		expect(splitSecretBlocks(source)).toMatchObject([{ kind: 'body', text: source }]);
	});

	it('reports offsets into the original source, so a caller can slice source.slice(start, end) back to text', () => {
		const source = [
			'Public sentence one.',
			'',
			':::secret',
			'Hidden fact.',
			':::',
			'',
			'Public sentence two.'
		].join('\n');

		const segments = splitSecretBlocks(source);
		expect(segments[0]!.text).toBe(source.slice(segments[0]!.start, segments[0]!.end));
		expect(segments[1]!.text).toBe(source.slice(segments[1]!.start, segments[1]!.end));
		expect(segments[2]!.text).toBe(source.slice(segments[2]!.start, segments[2]!.end));
		// The secret segment's offsets point at "Hidden fact." itself, not at the fence markers.
		expect(source.slice(segments[1]!.start, segments[1]!.end)).toBe('Hidden fact.');
	});

	it('gives an empty block a zero-length span at the position it opened', () => {
		const source = [':::secret', ':::', 'After.'].join('\n');
		const segments = splitSecretBlocks(source);
		expect(segments[0]).toMatchObject({ kind: 'secret', text: '' });
		expect(segments[0]!.start).toBe(segments[0]!.end);
	});
});

describe('stripSecretsForPlayers', () => {
	it('removes a secret block entirely, not just visually', () => {
		const source = [
			'A merchant bank that lends at knife point.',
			'',
			':::secret',
			'Aldric Vane is now on its payroll.',
			':::'
		].join('\n');

		const stripped = stripSecretsForPlayers(source);
		expect(stripped).not.toContain('Aldric Vane');
		expect(stripped).not.toContain(':::');
		expect(stripped).toContain('A merchant bank that lends at knife point.');
	});

	it('removes a GM note entirely, unconditionally', () => {
		const source = [
			'Public paragraph.',
			'',
			':::gmnote',
			'Play this reveal as her fault circling back.',
			':::'
		].join('\n');

		const stripped = stripSecretsForPlayers(source);
		expect(stripped).not.toContain('Play this reveal');
		expect(stripped).toBe('Public paragraph.');
	});

	it('leaves prose with no secret content untouched', () => {
		expect(stripSecretsForPlayers('Nothing hidden here.')).toBe('Nothing hidden here.');
	});

	it('strips both a secret and a gmnote from the same entry, keeping the prose between them', () => {
		const source = [
			'Opening line.',
			'',
			':::secret',
			'Hidden fact.',
			':::',
			'',
			'Middle line.',
			'',
			':::gmnote',
			'GM only note.',
			':::',
			'',
			'Closing line.'
		].join('\n');

		const stripped = stripSecretsForPlayers(source);
		expect(stripped).not.toContain('Hidden fact');
		expect(stripped).not.toContain('GM only note');
		expect(stripped).toContain('Opening line.');
		expect(stripped).toContain('Middle line.');
		expect(stripped).toContain('Closing line.');
	});

	it('an unclosed fence hides everything after it, never leaking a truncated tail', () => {
		const source = ['Visible.', '', ':::secret', 'This must never reach a player.'].join('\n');
		expect(stripSecretsForPlayers(source)).toBe('Visible.');
	});
});

// #306. A fact's evidence span is a pair of character offsets into the body that produced it,
// and offsets carry no idea of what they landed in, so every way a span can touch a fence is
// asserted here rather than left to the caller that happens to hold the offsets. Each span is
// built with `indexOf` on the source, so what a case is testing is readable from its needles
// and an off-by-one in this file cannot quietly agree with an off-by-one in the parser.
describe('isPlayerVisibleSpan', () => {
	const SOURCE = [
		'A merchant bank that lends at knife point.',
		'',
		':::secret',
		'Aldric Vane is now on its payroll.',
		':::',
		'',
		'It keeps better records than the magistrate.',
		'',
		':::gmnote',
		'Play this reveal as her fault circling back.',
		':::',
		'',
		'Closing line.'
	].join('\n');

	const at = (needle: string): number => {
		const index = SOURCE.indexOf(needle);
		if (index < 0) throw new Error(`test fixture does not contain "${needle}"`);
		return index;
	};
	const spanOf = (needle: string): [number, number] => [at(needle), at(needle) + needle.length];
	const spanFrom = (from: string, to: string): [number, number] => [at(from), at(to) + to.length];
	const visible = (span: [number, number]): boolean =>
		isPlayerVisibleSpan(SOURCE, span[0], span[1]);

	it('publishes a span wholly outside every fence', () => {
		const span = spanOf('A merchant bank that lends at knife point.');
		expect(visible(span)).toBe(true);
		expect(SOURCE.slice(span[0], span[1])).toBe('A merchant bank that lends at knife point.');
	});

	it('publishes a span in the body between two fences', () => {
		expect(visible(spanOf('It keeps better records than the magistrate.'))).toBe(true);
		expect(visible(spanOf('Closing line.'))).toBe(true);
	});

	it('withholds a span wholly inside a secret fence', () => {
		const span = spanOf('Aldric Vane is now on its payroll.');
		expect(visible(span)).toBe(false);
		// The excerpt this would have published, which is the whole point of withholding it.
		expect(SOURCE.slice(span[0], span[1])).toContain('Aldric Vane');
	});

	it('withholds a span wholly inside a gmnote fence', () => {
		expect(visible(spanOf('Play this reveal as her fault circling back.'))).toBe(false);
	});

	it('withholds a span that straddles an opening marker', () => {
		const span = spanFrom('lends at knife point.', 'Aldric Vane is now');
		expect(visible(span)).toBe(false);
		expect(SOURCE.slice(span[0], span[1])).toContain(':::secret');
	});

	it('withholds a span that straddles a closing marker', () => {
		const span = spanFrom('now on its payroll.', 'It keeps better records');
		expect(visible(span)).toBe(false);
		expect(SOURCE.slice(span[0], span[1])).toContain('payroll');
	});

	it('withholds a span that contains a whole fence in the middle', () => {
		const span = spanFrom('A merchant bank', 'It keeps better records than the magistrate.');
		expect(visible(span)).toBe(false);
		expect(SOURCE.slice(span[0], span[1])).toContain('Aldric Vane is now on its payroll.');
	});

	it('withholds a span covering a fence marker and nothing else', () => {
		expect(visible(spanOf(':::secret'))).toBe(false);
		expect(visible(spanOf(':::gmnote'))).toBe(false);
	});

	it('publishes up to the end of its body segment and stops one character short of the fence', () => {
		const [firstBody] = splitSecretBlocks(SOURCE);
		expect(firstBody).toMatchObject({ kind: 'body' });
		expect(isPlayerVisibleSpan(SOURCE, 0, firstBody!.end)).toBe(true);
		expect(isPlayerVisibleSpan(SOURCE, 0, firstBody!.end + 1)).toBe(false);
		// That one extra character is the newline the `:::secret` line starts after, so the
		// strict edge is what keeps a marker out of an excerpt rather than an arbitrary choice.
		expect(SOURCE.slice(firstBody!.end, firstBody!.end + 1)).toBe('\n');
		expect(SOURCE.startsWith(':::secret', firstBody!.end + 1)).toBe(true);
	});

	it('withholds everything after an unclosed fence, matching stripSecretsForPlayers', () => {
		const source = ['Visible.', '', ':::secret', 'This must never reach a player.'].join('\n');
		const hidden = source.indexOf('This must never reach a player.');
		expect(isPlayerVisibleSpan(source, hidden, source.length)).toBe(false);
		expect(isPlayerVisibleSpan(source, 0, 'Visible.'.length)).toBe(true);
	});

	it('withholds a span an entry with no fence at all could not have produced', () => {
		const source = 'Just some prose.';
		expect(isPlayerVisibleSpan(source, 0, source.length)).toBe(true);
		// Nonsense offsets fail closed rather than slicing to something short and plausible.
		expect(isPlayerVisibleSpan(source, 5, 5)).toBe(false);
		expect(isPlayerVisibleSpan(source, -1, 4)).toBe(false);
		expect(isPlayerVisibleSpan(source, 4, 2)).toBe(false);
		expect(isPlayerVisibleSpan(source, 0, source.length + 1)).toBe(false);
		expect(isPlayerVisibleSpan(source, 1.5, 4)).toBe(false);
	});
});
