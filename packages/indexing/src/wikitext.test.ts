import { describe, expect, it } from 'vitest';
import { wikitextToPlainText } from './wikitext.js';

describe('wikitextToPlainText', () => {
	it('drops html comments', () => {
		expect(wikitextToPlainText('Before<!-- hidden note -->After')).toBe('BeforeAfter');
	});

	it('drops <ref> footnotes, both self-closing and paired', () => {
		expect(
			wikitextToPlainText('A fact.<ref name="x" /> Another.<ref>Some citation</ref> End.')
		).toBe('A fact. Another. End.');
	});

	it('unwraps a piped internal link to its label', () => {
		expect(wikitextToPlainText('See [[Valdoria Reach|the Reach]] for details.')).toBe(
			'See the Reach for details.'
		);
	});

	it('unwraps a bare internal link to its title', () => {
		expect(wikitextToPlainText('See [[Valdoria Reach]] for details.')).toBe(
			'See Valdoria Reach for details.'
		);
	});

	it('drops file and category links entirely', () => {
		expect(wikitextToPlainText('Text.[[File:Map.png|thumb]] [[Category:Cities]]')).toBe('Text.');
	});

	it('unwraps external links to their label, and drops bare ones', () => {
		expect(wikitextToPlainText('Official site: [https://example.com Example].')).toBe(
			'Official site: Example.'
		);
		expect(wikitextToPlainText('Source: [https://example.com]')).toBe('Source:');
	});

	it('strips bold and italic markup', () => {
		expect(wikitextToPlainText("'''Aldric Vane''' was ''once'' the captain.")).toBe(
			'Aldric Vane was once the captain.'
		);
	});

	it('strips a simple (non-nested) template', () => {
		expect(wikitextToPlainText('{{Infobox|name=Aldric}}Aldric Vane was captain.')).toBe(
			'Aldric Vane was captain.'
		);
	});

	it('strips a table block', () => {
		const wikitext = ['Before.', '{|class="wikitable"', '|Row||Value', '|}', 'After.'].join('\n');
		expect(wikitextToPlainText(wikitext)).toBe('Before.\n\nAfter.');
	});

	it('strips raw html tags but keeps their inner text', () => {
		expect(wikitextToPlainText('Line one<br/>Line <b>two</b>.')).toBe('Line oneLine two.');
	});
});
