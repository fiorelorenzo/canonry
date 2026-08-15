// The guards are the point of these tests, not the happy path: a wrong guess means the
// copilot writes Italian prose into an English entry, which SPEC.md §17 calls vandalism with
// good intentions. Null has to be reachable and has to be reached in the cases that matter.
import { describe, expect, it } from 'vitest';
import { canonLanguageFor, detectLanguage, guessLanguage } from './detect.js';

const ENGLISH_ENTRY =
	'Dismissed from the watch in the thaw after the Sable Winter, he now answers to the Ashen Ledger. ' +
	'He still drinks at the Gilded Rat, in the corner seat nobody asks him to leave.';

const ITALIAN_ENTRY =
	'Cacciato dalla guardia nel disgelo dopo l\u2019Inverno Sabbia, ora risponde al Libro di Cenere. ' +
	'Beve ancora al Ratto Dorato, nel posto d\u2019angolo che nessuno gli chiede di lasciare.';

describe('detectLanguage (issue #122, SPEC.md §17)', () => {
	it('reads a real English entry as English', () => {
		expect(detectLanguage(ENGLISH_ENTRY)).toBe('en');
	});

	it('reads a real Italian entry as Italian', () => {
		expect(detectLanguage(ITALIAN_ENTRY)).toBe('it');
	});

	it('refuses to guess from a stub, because the value decides what language gets written', () => {
		expect(detectLanguage('Aldric Vane')).toBeNull();
		expect(detectLanguage('The Gilded Rat')).toBeNull();
	});

	it('refuses to guess a body that is genuinely mixed', () => {
		const mixed = `${ENGLISH_ENTRY}\n\n${ITALIAN_ENTRY}`;
		expect(detectLanguage(mixed)).toBeNull();
	});

	it('is not fooled by a page of proper nouns, which is a real entry shape', () => {
		const roster =
			'Aldric Vane. Iselde Wrenn. Corvin Ashe. Mother Sennah. The Valdoria Watch. ' +
			'The Ashen Ledger. Cairnmouth. Duskwood Vale. The Gilded Rat. Valdoria.';
		expect(detectLanguage(roster)).toBeNull();
	});

	it('splits elisions, since that is where Italian keeps its strongest markers', () => {
		const guess = guessLanguage(
			"L'oste della locanda non parla mai dei debiti che il conte ha con lui"
		);
		expect(guess.language).toBe('it');
		expect(guess.hits.it).toBeGreaterThan(guess.hits.en);
	});

	it('reports why, not only what', () => {
		const guess = guessLanguage(ENGLISH_ENTRY);
		expect(guess.wordCount).toBeGreaterThan(20);
		expect(guess.hits.en).toBeGreaterThan(guess.hits.it);
	});
});

describe('canonLanguageFor (issue #124, SPEC.md §17)', () => {
	it("uses the target entry's own recorded language above everything else", () => {
		expect(
			canonLanguageFor({
				targetLanguage: 'it',
				targetBody: ENGLISH_ENTRY,
				triggerBody: ENGLISH_ENTRY
			})
		).toBe('it');
	});

	it('falls back to detecting the target body when nobody recorded a language', () => {
		expect(canonLanguageFor({ targetBody: ITALIAN_ENTRY })).toBe('it');
	});

	it('falls back to the entry that triggered the change, never to the reader', () => {
		// A stub target: unknowable. The trigger is Italian canon, so Italian is the honest
		// choice, and the interface locale deliberately has no say here at all.
		expect(canonLanguageFor({ targetBody: 'Cairnmouth', triggerBody: ITALIAN_ENTRY })).toBe('it');
	});

	it('ends at English when nothing is known, rather than at the interface language', () => {
		expect(canonLanguageFor({})).toBe('en');
	});

	it('tolerates a stored regional tag', () => {
		expect(canonLanguageFor({ targetLanguage: 'it-CH' })).toBe('it');
	});
});
