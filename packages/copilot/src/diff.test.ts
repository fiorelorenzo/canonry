import { describe, expect, it } from 'vitest';
import { semanticDiff, splitIntoSentences, tokenize } from './diff.js';

describe('splitIntoSentences', () => {
	it('splits a paragraph into sentences and keeps a heading as its own unit', () => {
		const body =
			'Dismissed from the watch, he now answers to the Ledger. He still drinks at the Rat.\n\n## Standing in the city\n\nForty of them still would.';
		expect(splitIntoSentences(body)).toEqual([
			'Dismissed from the watch, he now answers to the Ledger.',
			'He still drinks at the Rat.',
			'## Standing in the city',
			'Forty of them still would.'
		]);
	});

	it('drops blank lines and trims whitespace', () => {
		expect(splitIntoSentences('  One sentence.  \n\n\n  Another one.  ')).toEqual([
			'One sentence.',
			'Another one.'
		]);
	});
});

describe('tokenize (issue #577: possessives and plain forms share a bucket)', () => {
	it('folds a plural possessive onto the plain word, in both directions', () => {
		expect(tokenize("The Smugglers' Ledger")).toEqual(new Set(['the', 'smugglers', 'ledger']));
		expect(tokenize('the Smugglers Ledger')).toEqual(new Set(['the', 'smugglers', 'ledger']));
	});

	it("folds a singular possessive 's onto the plain word", () => {
		expect(tokenize("the Lantern Quarter's debt")).toEqual(
			new Set(['the', 'lantern', 'quarter', 'debt'])
		);
	});

	it('drops an apostrophe that is only punctuation, rather than emitting it as a token', () => {
		expect(tokenize("' 's ''")).toEqual(new Set());
		expect(tokenize("'ledger'")).toEqual(new Set(['ledger']));
	});

	it('leaves an apostrophe inside a word alone, and moves only one at the end', () => {
		// An Italian elision is not a possessive: splitting these would hand Ask's
		// content-word filter `l`, `dell`, `nell` and `d`, none of which is in
		// @canonry/lang's Italian function-word list, so each would score matches on an
		// article. They tokenize exactly as they did before #577.
		for (const word of ["l'oste", "dell'inverno", "un'ora", "nell'ombra", "d'oro"]) {
			expect(tokenize(word)).toEqual(new Set([word]));
		}
		// The two Italian words that do move, and both only because the apostrophe is the
		// last character the token pattern kept: `c'è` already arrived here as `c'` (the `è`
		// is outside the pattern's alphabet), and the Italian function-word list is
		// tokenized through this same function, so it moves with it.
		expect(tokenize("c'è")).toEqual(new Set(['c']));
		expect(tokenize("un po'")).toEqual(new Set(['un', 'po']));
	});

	it('still folds an English contraction the same way it always did', () => {
		// `don't` keeps its apostrophe because it is internal; `it's` loses a trailing `'s`
		// and lands on `it`, which the English function-word list already carries.
		expect(tokenize("don't")).toEqual(new Set(["don't"]));
		expect(tokenize("it's")).toEqual(new Set(['it']));
	});
});

describe('semanticDiff', () => {
	it('reports no changes when the body is untouched', () => {
		const body = 'Aldric works for the Ledger. He drinks at the Rat.';
		expect(semanticDiff(body, body)).toEqual([]);
	});

	it('reports a pure addition as added, in reading order', () => {
		const oldBody = 'Aldric works for the Ledger.';
		const newBody = 'Aldric works for the Ledger. Iselde is reviewing his appointment.';
		expect(semanticDiff(oldBody, newBody)).toEqual([
			{ kind: 'added', statement: 'Iselde is reviewing his appointment.' }
		]);
	});

	it('reports a pure removal as removed', () => {
		const oldBody = 'Aldric works for the Ledger. He drinks at the Rat.';
		const newBody = 'Aldric works for the Ledger.';
		expect(semanticDiff(oldBody, newBody)).toEqual([
			{ kind: 'removed', statement: 'He drinks at the Rat.' }
		]);
	});

	it('pairs a reworded sentence as changed rather than remove-plus-add', () => {
		const oldBody = 'Aldric was dismissed from the watch in the thaw.';
		const newBody = 'Aldric was dismissed from the watch after the freeze broke.';
		const result = semanticDiff(oldBody, newBody);
		expect(result).toEqual([
			{
				kind: 'changed',
				statement: 'Aldric was dismissed from the watch after the freeze broke.',
				previousStatement: 'Aldric was dismissed from the watch in the thaw.'
			}
		]);
	});

	it('does not pair an unrelated remove and add into a false "changed"', () => {
		const oldBody = 'Aldric drinks at the Gilded Rat.';
		const newBody = 'A merchant caravan arrived from the coast this week.';
		const result = semanticDiff(oldBody, newBody);
		expect(result).toContainEqual({
			kind: 'removed',
			statement: 'Aldric drinks at the Gilded Rat.'
		});
		expect(result).toContainEqual({
			kind: 'added',
			statement: 'A merchant caravan arrived from the coast this week.'
		});
		expect(result.every((c) => c.kind !== 'changed')).toBe(true);
	});

	it('handles a heading addition and an appended paragraph together', () => {
		const oldBody = 'Aldric works for the Ledger.';
		const newBody =
			'Aldric works for the Ledger.\n\n## Standing in the city\n\nForty sworn still trust him.';
		const result = semanticDiff(oldBody, newBody);
		expect(result).toEqual([
			{ kind: 'added', statement: '## Standing in the city' },
			{ kind: 'added', statement: 'Forty sworn still trust him.' }
		]);
	});
});
