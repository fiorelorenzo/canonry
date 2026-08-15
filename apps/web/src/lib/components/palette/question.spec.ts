import { describe, expect, it } from 'vitest';
import { looksLikeQuestion } from './question';

describe('looksLikeQuestion', () => {
	it('is false for an empty or whitespace-only query', () => {
		expect(looksLikeQuestion('')).toBe(false);
		expect(looksLikeQuestion('   ')).toBe(false);
	});

	it('is false for a short name, the common case the classifier must not catch', () => {
		expect(looksLikeQuestion('Aldric')).toBe(false);
		expect(looksLikeQuestion('The Valdoria Watch')).toBe(false);
	});

	it('is true for any query carrying a question mark', () => {
		expect(looksLikeQuestion('watch?')).toBe(true);
	});

	it('is true for a query over five words, mark or not', () => {
		expect(looksLikeQuestion('the sentinel who guarded the old gate at dawn')).toBe(true);
	});

	it('is true for a query starting with what, why, how or who', () => {
		expect(looksLikeQuestion('what happened to the watch')).toBe(true);
		expect(looksLikeQuestion('why did the watch fall')).toBe(true);
		expect(looksLikeQuestion('how did Aldric die')).toBe(true);
		expect(looksLikeQuestion('who is Aldric')).toBe(true);
	});

	it('is case-insensitive on the starter word', () => {
		expect(looksLikeQuestion('What happened')).toBe(true);
	});

	it('is false for a starter-like word that is not actually a starter', () => {
		expect(looksLikeQuestion('Whatnot the tavern')).toBe(false);
	});
});
