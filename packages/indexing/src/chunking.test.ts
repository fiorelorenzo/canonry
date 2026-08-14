import { describe, expect, it } from 'vitest';
import { chunkWikiPage, estimateTokens, DEFAULT_CHUNK_TOKEN_BUDGET } from './chunking.js';

describe('estimateTokens', () => {
	it('estimates roughly one token per four characters', () => {
		expect(estimateTokens('a'.repeat(400))).toBe(100);
	});
});

describe('chunkWikiPage', () => {
	it('breadcrumbs the page title alone when there are no headings', () => {
		const chunks = chunkWikiPage('Valdoria Reach', 'A short paragraph with no headings at all.');
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ index: 0, breadcrumb: 'Valdoria Reach' });
		expect(chunks[0]!.text).toContain('A short paragraph');
	});

	it('builds a nested breadcrumb from heading levels', () => {
		const wikitext = [
			'Intro paragraph.',
			'',
			'== History ==',
			'History paragraph.',
			'',
			'=== The Sable Winter ===',
			'Sable Winter paragraph.',
			'',
			'== Geography ==',
			'Geography paragraph.'
		].join('\n');
		const chunks = chunkWikiPage('Cairnmouth', wikitext);
		const breadcrumbs = chunks.map((c) => c.breadcrumb);
		expect(breadcrumbs).toEqual([
			'Cairnmouth',
			'Cairnmouth > History',
			'Cairnmouth > History > The Sable Winter',
			'Cairnmouth > Geography'
		]);
	});

	it('pops back to a shallower heading level correctly (does not keep a stale deep breadcrumb)', () => {
		const wikitext = ['== A ==', 'a text', '=== A1 ===', 'a1 text', '== B ==', 'b text'].join('\n');
		const chunks = chunkWikiPage('Page', wikitext);
		expect(chunks.map((c) => c.breadcrumb)).toEqual(['Page > A', 'Page > A > A1', 'Page > B']);
	});

	it('keeps a paragraph whole when it fits the token budget', () => {
		const paragraph = 'word '.repeat(20).trim();
		const chunks = chunkWikiPage('Page', paragraph, { tokenBudget: 100 });
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.text).toBe(paragraph);
	});

	it('splits a section into multiple chunks once the token budget is exceeded', () => {
		const paragraphs = Array.from({ length: 5 }, (_, i) => `Paragraph ${i} `.repeat(30).trim());
		const wikitext = paragraphs.join('\n\n');
		const chunks = chunkWikiPage('Page', wikitext, { tokenBudget: 60 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(60);
		}
		// Nothing lost: every paragraph's marker text survives somewhere in the chunks.
		const joined = chunks.map((c) => c.text).join(' ');
		for (let i = 0; i < paragraphs.length; i++) {
			expect(joined).toContain(`Paragraph ${i}`);
		}
	});

	it('splits a single over-budget paragraph on sentence boundaries', () => {
		const sentences = Array.from({ length: 8 }, (_, i) => `This is sentence number ${i}.`);
		const wikitext = sentences.join(' ');
		const chunks = chunkWikiPage('Page', wikitext, { tokenBudget: 20 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(20);
		}
	});

	it('assigns stable, increasing indices across the whole page', () => {
		const wikitext = ['== A ==', 'a', '== B ==', 'b'].join('\n');
		const chunks = chunkWikiPage('Page', wikitext);
		expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
	});

	it('uses the default token budget when none is given', () => {
		const chunks = chunkWikiPage('Page', 'text');
		expect(DEFAULT_CHUNK_TOKEN_BUDGET).toBeGreaterThan(0);
		expect(chunks).toHaveLength(1);
	});
});
