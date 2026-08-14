import { describe, expect, it } from 'vitest';
import { splitSecretBlocks, stripSecretsForPlayers } from './markdown-secrets';

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
