/**
 * Issue #576: an Italian string may not put a gendered participle or adjective straight
 * after an interpolated value, because the catalogue cannot know that value's gender.
 *
 * The defect was `table.home.actionFailed`, which composed `${action} non riuscita` out of
 * a label produced elsewhere: with "+ PNG qui" the toast read "+ PNG qui non riuscita",
 * where Italian wants "riuscito". `table.home.markedRevealed` had the mirror of it,
 * `${name} segnato come rivelato`, against a place name that is as often feminine as not.
 * Neither is fixable by rewording, so both were reshaped to put the interpolated value in
 * a position that governs nothing.
 *
 * This pins the construction rather than either sentence, so a rewording stays free while
 * the shape stays out, and a key added later is covered without anybody remembering to add
 * it here. Same walk as `it-passive-calques.test.ts`, except the sample arguments carry a
 * sentinel: the rendered string is then searched for what follows the value that was
 * interpolated, which is the only position where agreement is decided by the caller.
 */
import { describe, expect, it as test } from 'vitest';
import { it as itMessages } from './it.js';

/** Stands in for whatever a caller interpolates: an entity name, a type label, a file
 * name. Deliberately not a word, so nothing about it can be mistaken for Italian. */
const VALUE = '\u2039valore\u203A';

/**
 * Regular past participles, which is most of them, plus the gendered adjectives that
 * plausibly follow a value in this product's copy. Both genders, because the defect is
 * agreement and not a gender: `${name} salvato` is exactly as wrong as `${name} salvata`
 * when the name can be either.
 *
 * Singular only, on purpose. A plural word right after an interpolation is, everywhere in
 * this catalogue, the noun a count is counting ("${n} crediti", "${n} chiamate"), and
 * those are as often participle-shaped as not ("${n} documenti elaborati"). Matching them
 * would mean an allowlist entry for every counted noun, which is a gate nobody reads. The
 * position #576 is about takes one label, so it is always singular.
 */
const REGULAR_PARTICIPLE = '[a-zà-ÿ]+(?:at[ao]|it[ao]|ut[ao])';
const IRREGULAR = [
	'fatt',
	'scritt',
	'lett',
	'vist',
	'pers',
	'rimoss',
	'apert',
	'chius',
	'mess',
	'pres',
	'sospes',
	'conclus',
	'esclus',
	'inclus'
];
const ADJECTIVE = ['nuov', 'pront', 'vuot', 'obsolet', 'pien', 'sicur', 'compless'];

/** A value, then at most one adverb that does not break the agreement ("non riuscita" is
 * the shape #576 was), then a word that has to agree with something. */
const AGREES_WITH_THE_VALUE = new RegExp(
	`${VALUE}\\s+(?:non|gi\u00e0|ancora|mai|appena|ora)?\\s*` +
		`(?:${REGULAR_PARTICIPLE}|(?:${[...IRREGULAR, ...ADJECTIVE].join('|')})[ao])\\b`,
	'i'
);

/**
 * Keys where the word after the value agrees with a noun the sentence fixes rather than
 * with the value itself, so no caller can make it wrong. One entry today.
 */
const REFERENT_IS_FIXED: Record<string, string> = {
	// A file name is read as "il file <name>", and the referent is the file, which is
	// masculine whatever the name is. A place name is not like this: "La Locanda" carries
	// its own gender into the sentence, which is why #576's two strings moved and this
	// one did not.
	'import.upload.confirm.uploadedSummary': 'the referent is "il file", not the file name'
};

/** Every string the Italian catalogue can produce, with its key path, rendered with a
 * sentinel wherever a caller would interpolate a name or a label. A function that needs a
 * shape this cannot guess throws, and is skipped rather than failing the sweep. */
function italianStrings(value: unknown, prefix = ''): [string, string][] {
	if (typeof value === 'string') return [[prefix, value]];
	if (typeof value === 'function') {
		const samples: unknown[][] = [
			[VALUE, VALUE, VALUE],
			[1, VALUE, 2],
			[VALUE, 1, VALUE],
			[1, 2, 3],
			[{ kind: 'generic', files: 2 }]
		];
		for (const args of samples) {
			try {
				const produced = (value as (...a: unknown[]) => unknown)(...args);
				if (typeof produced === 'string') return [[prefix, produced]];
				if (typeof produced === 'object' && produced !== null) {
					return Object.values(produced)
						.filter((part): part is string => typeof part === 'string')
						.map((part, index) => [`${prefix}[${index}]`, part]);
				}
			} catch {
				continue;
			}
		}
		return [];
	}
	if (typeof value !== 'object' || value === null) return [];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
		italianStrings(child, prefix ? `${prefix}.${key}` : key)
	);
}

describe('the Italian catalogue (issue #576)', () => {
	const strings = italianStrings(itMessages);
	const interpolating = strings.filter(([, line]) => line.includes(VALUE));

	test('reaches enough interpolating strings for a green run to mean something', () => {
		expect(interpolating.length).toBeGreaterThan(100);
	});

	test('the detector still recognises the shape #576 removed', () => {
		// Without this a typo in the pattern turns the sweep below into a no-op that
		// passes forever. Both of #576's original sentences, verbatim.
		expect(AGREES_WITH_THE_VALUE.test(`${VALUE} non riuscita: motivo sconosciuto`)).toBe(true);
		expect(AGREES_WITH_THE_VALUE.test(`${VALUE} segnato come rivelato`)).toBe(true);
		// And does not fire on a value that governs nothing after it.
		expect(AGREES_WITH_THE_VALUE.test(`Rivelazione registrata: ${VALUE}`)).toBe(false);
		expect(AGREES_WITH_THE_VALUE.test(`Nota salvata su ${VALUE}`)).toBe(false);
	});

	test('never makes a participle or an adjective agree with an interpolated value', () => {
		const offenders = interpolating
			.filter(([key]) => !(key in REFERENT_IS_FIXED))
			.filter(([, line]) => AGREES_WITH_THE_VALUE.test(line));
		expect(offenders.map(([key, line]) => `${key}: ${line}`)).toEqual([]);
	});

	test('the table failure toast is one sentence per action, not a label plus a suffix', () => {
		// Guardrail: the shape is the fix, so a later change back to a composed message
		// fails here as well as in the sweep above.
		const failed = itMessages.table.home.actionFailed;
		for (const message of [failed.npc(VALUE), failed.location(VALUE), failed.reveal(VALUE)]) {
			expect(message).toMatch(/^Non \u00e8 stato possibile /);
			expect(message.endsWith(VALUE)).toBe(true);
		}
	});
});
