/**
 * Issue #346. What this data is for is deciding whether a word overlap between a question
 * and a canon sentence means anything, so the assertions worth writing are about the two
 * ways the list can be wrong: too small, and a shared `of the` reads as a citation again;
 * too large, and a real question loses the word it was asking about.
 */
import { describe, expect, it } from 'vitest';
import { functionWords, LOCALES_WITH_FUNCTION_WORDS } from './function-words.js';
import { LOCALES } from './locale.js';

describe('functionWords (issue #346)', () => {
	it('covers every locale the product ships, since a locale without a list is a locale where a shared "the" is evidence again', () => {
		expect([...LOCALES_WITH_FUNCTION_WORDS].sort()).toEqual([...LOCALES].sort());
	});

	it('carries the words the sample world actually produced coincidences on', () => {
		// Every one of these was the entire shared overlap behind a source Ask cited for a
		// broad question, measured on the seeded sample world and recorded on #346.
		for (const word of ['the', 'of', 'is', 'in', 'this', 'about', 'now'])
			expect(functionWords('en')).toContain(word);
		for (const word of ['di', 'i', 'e', 'questo', 'chi', 'cosa'])
			expect(functionWords('it')).toContain(word);
	});

	it('leaves the classes a stopword list normally swallows, because a world can be asked about them', () => {
		// Numerals: most Italian stopword lists carry `due`, and a world where two ports
		// matter has to be able to ask which two. `un`/`una`/`uno` are the exception and are
		// in the list, because in Italian they are the indefinite article before they are the
		// number.
		for (const numeral of ['due', 'tre', 'quattro', 'cento'])
			expect(functionWords('it')).not.toContain(numeral);
		for (const numeral of ['one', 'two', 'three', 'hundred'])
			expect(functionWords('en')).not.toContain(numeral);
		// `stato` is a past participle and also a polity. `will` is an auxiliary and also a
		// bequest. Both would cost a real question to buy a marginal match.
		expect(functionWords('it')).not.toContain('stato');
		expect(functionWords('en')).not.toContain('will');
	});

	it('never swallows a word the sample world uses as canon', () => {
		for (const word of ['watch', 'winter', 'keeps', 'debt', 'holds'])
			expect(functionWords('en')).not.toContain(word);
		for (const word of ['casa', 'mercanti', 'registri', 'tiene', 'porto'])
			expect(functionWords('it')).not.toContain(word);
	});
});
