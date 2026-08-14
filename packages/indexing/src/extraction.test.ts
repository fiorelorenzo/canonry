import { describe, expect, it } from 'vitest';
import { heuristicExtractor } from './extraction.js';

describe('heuristicExtractor', () => {
	it('produces a summary, at least one question, and keywords drawn from the excerpt', async () => {
		const metadata = await heuristicExtractor({
			pageTitle: 'Valdoria Reach',
			breadcrumb: 'Valdoria Reach > History',
			text: 'Valdoria Reach is a coastal trading city. Merchants gather in the Lantern Quarter every dusk.'
		});
		expect(metadata.sectionSummary.length).toBeGreaterThan(0);
		expect(metadata.questionsThisExcerptCanAnswer.length).toBeGreaterThan(0);
		expect(metadata.excerptKeywords.length).toBeGreaterThan(0);
		expect(metadata.excerptKeywords).toContain('valdoria');
	});

	it('is deterministic for the same input', async () => {
		const input = {
			pageTitle: 'A',
			breadcrumb: 'A',
			text: 'The quick brown fox jumps over the lazy dog.'
		};
		const first = await heuristicExtractor(input);
		const second = await heuristicExtractor(input);
		expect(first).toEqual(second);
	});
});
