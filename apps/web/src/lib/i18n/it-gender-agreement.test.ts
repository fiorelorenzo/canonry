/**
 * Issue #576: an Italian string may not put a gendered participle or adjective straight
 * after a value the catalogue cannot know the gender of.
 *
 * The defect was `table.home.actionFailed`, which composed `${action} non riuscita` out of
 * a label produced elsewhere: with "+ PNG qui" the toast read "+ PNG qui non riuscita",
 * where Italian wants "riuscito". `table.home.markedRevealed` had the mirror of it,
 * `${name} segnato come rivelato`, against a place name that is as often feminine as not.
 * Neither is fixable by rewording, so both were reshaped to put the interpolated value in
 * a position that governs nothing.
 *
 * **A count is not a label, and that distinction is the whole rule.** "1 credito già speso"
 * and "2 crediti già spesi" (`proposals.checklist.spentCredits`, issue #572) put a
 * participle right after an interpolated value and are perfectly correct, because the
 * string chose that participle from the very number it is agreeing with. The bug is only
 * ever a value the string cannot see: a name or a label decided in another file. So this
 * walk classifies every argument position first, by rendering it twice with two different
 * numbers and asking whether anything but the number itself changed. If the prose moved,
 * the string is agreeing with a count it can read, and the position is not a risk. If only
 * the digits moved, the string is substituting blind, and that position gets checked.
 *
 * Encoding it that way rather than as an allowlist entry per sentence matters: an
 * allowlist would need a new line for every counted noun anybody ever writes, which is a
 * gate nobody reads, and it would have to grow on a PR that did nothing wrong.
 *
 * Same walk as `it-passive-calques.test.ts` otherwise: it pins the construction rather
 * than any sentence, so a rewording stays free while the shape stays out, and a key added
 * later is covered without anybody remembering to add it here.
 */
import { describe, expect, it as test } from 'vitest';
import { it as itMessages } from './it.js';

/** Stands in for whatever a caller interpolates: an entity name, a type label, a file
 * name. Deliberately not a word, so nothing about it can be mistaken for Italian. */
const VALUE = '\u2039valore\u203A';
/** Two counts far enough apart to land in different Italian plural forms, and rare enough
 * that neither collides with a digit written into the copy itself. */
const ONE = 1;
const MANY = 77777;
/** Fills the argument positions that are not under test: no digits, no sentinel. */
const FILLER = 'X';

/**
 * Regular past participles, which is most of them, plus the gendered adjectives that
 * plausibly follow a value in this product's copy. All four endings, because the defect is
 * agreement and not a gender: `${name} salvato` is exactly as wrong as `${name} salvata`
 * when the name can be either, and `${labels} mostrati` as wrong as `mostrate`.
 */
const REGULAR_PARTICIPLE = '[a-zà-ÿ]+(?:at[aeio]|it[aeio]|ut[aeio])';
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
	'spes',
	'conclus',
	'esclus',
	'inclus'
];
const ADJECTIVE = ['nuov', 'pront', 'vuot', 'obsolet', 'pien', 'sicur', 'compless'];

/**
 * Nouns that end like a regular participle and are not one, so the scan steps over them
 * and keeps reading. Vocabulary rather than an exception list: one entry covers every
 * sentence that ever counts credits, present or future, where a key-path allowlist would
 * need a new line per sentence.
 *
 * Stepping over rather than bailing out is the part that matters. "${n} crediti, ..." is
 * clean and "${n} crediti già spesi" would not be, and only a scan that keeps going past
 * the noun can tell those apart.
 */
const COUNTED_NOUN = '(?:credit[oi])';

/** A value, then optionally the noun it is counting, then at most one adverb that does not
 * break the agreement ("non riuscita" is the shape #576 was), then a word that has to
 * agree with something. */
const AGREES_WITH_THE_VALUE = new RegExp(
	`${VALUE}\\s+(?:${COUNTED_NOUN}\\b[,;:.]?\\s*)?(?:(?:non|gi\u00e0|ancora|mai|appena|ora)\\s+)?` +
		`(?!${COUNTED_NOUN}\\b)` +
		`(?:${REGULAR_PARTICIPLE}|(?:${[...IRREGULAR, ...ADJECTIVE].join('|')})[aeio])\\b`,
	'i'
);

/** Every word this file knows to be gendered, in one alternation, so the two rules below
 * share a vocabulary rather than drifting apart. */
const GENDERED_WORD = `(?:${REGULAR_PARTICIPLE}|(?:${[...IRREGULAR, ...ADJECTIVE].join('|')})[aeio])`;

/**
 * Issue #584: the mirror of the rule above, and a shape that one is structurally blind to.
 *
 * `proposals.queue.acceptedToast` was `Accettato: ${entityName}`, where the participle
 * comes FIRST and the value it agrees with comes after it. Nothing follows the value, so
 * `AGREES_WITH_THE_VALUE` reads the line as clean, and it is exactly as wrong: the
 * participle is doing a heading's work over a name whose gender the catalogue cannot know,
 * and it disagreed with the "la voce" fallback the same string chose.
 *
 * Two things keep it from firing on the rest of the catalogue, and both are the same
 * observation: a gendered word can only be wrong when the value is the one thing left for
 * it to agree with.
 *
 * The first is that the whole line has to be the gendered word and the value, not just
 * open with one. A gendered word at the start of a longer sentence nearly always agrees
 * with a subject the surface fixes and the sentence never names: "derivato da ${universe}"
 * is about the universe, "usata l'ultima volta il ${date}" about the API key, "Crediti per
 * ${operation}" is not even a participle. Eighteen lines in the catalogue read that way and
 * every one of them is correct, so a rule that looked at the first word alone would be
 * noise.
 *
 * The second is that the line has to begin a sentence, which is why this one check is
 * case-sensitive. "modificata: ${when}" and "cambiata ${when}" are fragments hung under an
 * entry card that has just rendered the entry's own name, so their subject is on screen and
 * the lower case is how the catalogue says so. A capitalised line has no such context: it
 * is a toast or a heading standing on its own, and it has to carry its own subject.
 */
const CAPITALISED_GENDERED_WORD =
	`(?:[A-Z\u00c0-\u00dd][a-z\u00e0-\u00ff]*(?:at[aeio]|it[aeio]|ut[aeio])` +
	`|(?:${[...IRREGULAR, ...ADJECTIVE].map((stem) => stem[0].toUpperCase() + stem.slice(1)).join('|')})[aeio])`;
const HEADS_THE_VALUE_ALONE = new RegExp(
	`^\\s*(?:(?:Non|Gi\u00e0|Ancora|Mai)\\s+${GENDERED_WORD}|${CAPITALISED_GENDERED_WORD})` +
		`\\s*[:\u00b7\u2013-]?\\s*${VALUE}\\s*$`
);

/**
 * Keys where the gendered word agrees with a noun the sentence fixes rather than with the
 * value itself, so no caller can make it wrong. Three entries today, and the reason has to
 * be a referent the surface really does fix: a name that carries its own gender into the
 * sentence is never one of these.
 */
const REFERENT_IS_FIXED: Record<string, string> = {
	// A file name is read as "il file <name>", and the referent is the file, which is
	// masculine whatever the name is. A place name is not like this: "La Locanda" carries
	// its own gender into the sentence, which is why #576's two strings moved and this
	// one did not.
	'import.upload.confirm.uploadedSummary': 'the referent is "il file", not the file name',
	// Issue #584: these two look exactly like the `acceptedToast` this issue fixed, and
	// they are the opposite case. The value is a format ("Obsidian", "Markdown") or a
	// language ("Italiano"), and what the participle agrees with is "il formato" and "la
	// lingua", which the surface fixes: the upload confirmation detects a format and
	// nothing else, the language prefix a language and nothing else. `acceptedToast` had
	// no such referent, because the value there was the subject.
	'import.upload.confirm.detected': 'the referent is "il formato", not the format name',
	'entry.language.detectedPrefix': 'the referent is "la lingua", not the language name'
};

/**
 * One rendered line out of one catalogue entry.
 *
 * A function that answers `{ prefix, suffix }` is rendered as `prefix + value + suffix`,
 * because that is what the component does with it: the value lands between the two halves,
 * and the word right after it is the one that has to agree. Reading the two halves as
 * separate strings, which an earlier version of this file did, misses that position
 * entirely, which is how #572's credits lines went through this sweep unlooked-at.
 */
function render(fn: (...a: unknown[]) => unknown, args: unknown[], slot: string): string | null {
	let produced: unknown;
	try {
		produced = fn(...args);
	} catch {
		return null;
	}
	if (typeof produced === 'string') return produced;
	if (typeof produced === 'object' && produced !== null) {
		const parts = produced as Record<string, unknown>;
		if (typeof parts.prefix === 'string' && typeof parts.suffix === 'string') {
			return `${parts.prefix}${slot}${parts.suffix}`;
		}
		return Object.values(parts)
			.filter((part): part is string => typeof part === 'string')
			.join(' ');
	}
	return null;
}

/**
 * Every line the Italian catalogue can produce with a label in it, and its key path.
 *
 * A plain string has no interpolation and nothing to check. A function is probed one
 * argument position at a time: two numbers first, to find out whether that position is a
 * count the string agrees with, and only then the label sentinel. A rendering that does
 * not contain the sentinel is dropped, which is what keeps the arguments this cannot guess
 * (option objects, enum keys) out of the results instead of producing nonsense.
 */
function labelLines(value: unknown, prefix = ''): [string, string][] {
	if (typeof value === 'function') {
		const fn = value as (...a: unknown[]) => unknown;
		const arity = Math.min(Math.max(fn.length, 1), 4);
		const lines: [string, string][] = [];
		for (let i = 0; i < arity; i++) {
			// One position under test at a time, every other one filled with a neutral token
			// that is neither the sentinel nor a digit: another position's sentinel in the
			// same line would be read as this one's, and another position's digit would be
			// blanked out below along with the count actually being probed.
			const args = (fill: unknown) =>
				Array.from({ length: arity }, (_, j) => (j === i ? fill : FILLER));
			// Blank the rendered count out of each, so the comparison sees everything else.
			const one = render(fn, args(ONE), String(ONE))?.split(String(ONE)).join('#');
			const many = render(fn, args(MANY), String(MANY))?.split(String(MANY)).join('#');
			if (one !== undefined && many !== undefined && one !== many) {
				// The prose moved with the number: this position is a count the string can
				// read, and whatever agrees with it agrees correctly by construction.
				continue;
			}
			const line = render(fn, args(VALUE), VALUE);
			if (line === null || !line.includes(VALUE)) continue;
			lines.push([prefix, line]);
		}
		return lines;
	}
	if (typeof value !== 'object' || value === null) return [];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
		labelLines(child, prefix ? `${prefix}.${key}` : key)
	);
}

describe('the Italian catalogue (issue #576)', () => {
	const lines = labelLines(itMessages);

	test('reaches enough label positions for a green run to mean something', () => {
		expect(lines.length).toBeGreaterThan(100);
	});

	test('the detector still recognises the shape #576 removed', () => {
		// Without this a typo in the pattern turns the sweep below into a no-op that
		// passes forever. Both of #576's original sentences, verbatim.
		expect(AGREES_WITH_THE_VALUE.test(`${VALUE} non riuscita: motivo sconosciuto`)).toBe(true);
		expect(AGREES_WITH_THE_VALUE.test(`${VALUE} segnato come rivelato`)).toBe(true);
		// The scan steps over a counted noun and keeps reading, so a participle hidden
		// behind one is still caught. #572's real lines never reach this: their argument is
		// a count, and `labelLines` drops those before the pattern ever sees them.
		expect(AGREES_WITH_THE_VALUE.test(`${VALUE} crediti gi\u00e0 spesi per questa bozza`)).toBe(
			true
		);
		// A counted noun with nothing agreeing after it is clean, which is what stops
		// `admin.pricing.lastChangeSummary` reading as a defect.
		expect(AGREES_WITH_THE_VALUE.test(`X \u2192 ${VALUE} crediti, X, X`)).toBe(false);
		// And a value that governs nothing after it.
		expect(AGREES_WITH_THE_VALUE.test(`Rivelazione registrata: ${VALUE}`)).toBe(false);
		expect(AGREES_WITH_THE_VALUE.test(`Nota salvata su ${VALUE}`)).toBe(false);
	});

	test('a count the string can read is not treated as a label', () => {
		// #572's credits lines are the case this rule exists to let through: the participle
		// sits right after the number, and it is right, because the same number chose it.
		const spent = itMessages.proposals.checklist.spentCredits.audit;
		expect(spent(1).suffix.trim()).toMatch(/^credito gi\u00e0 speso\b/);
		expect(spent(2).suffix.trim()).toMatch(/^crediti gi\u00e0 spesi\b/);
		// The count position of each is skipped outright, so neither can ever be read as a
		// label. `keptSuffix` still contributes a line, because its second argument (the
		// cap) really is a substitution, and that line has to stay clean on its own.
		expect(lines.map(([key]) => key)).not.toContain('proposals.checklist.spentCredits.audit');
		const kept = lines.filter(([key]) => key === 'proposals.checklist.keptSuffix');
		expect(kept.length).toBe(1);
		expect(kept.every(([, line]) => !new RegExp(`${VALUE}\\s+mantenut`).test(line))).toBe(true);
	});

	test('never makes a participle or an adjective agree with an interpolated label', () => {
		const offenders = lines
			.filter(([key]) => !(key in REFERENT_IS_FIXED))
			.filter(([, line]) => AGREES_WITH_THE_VALUE.test(line));
		expect(offenders.map(([key, line]) => `${key}: ${line}`)).toEqual([]);
	});

	test('the heading detector recognises the shape #584 removed', () => {
		// `acceptedToast` before #584, verbatim.
		expect(HEADS_THE_VALUE_ALONE.test(`Accettato: ${VALUE}`)).toBe(true);
		expect(HEADS_THE_VALUE_ALONE.test(`Accettata \u00b7 ${VALUE}`)).toBe(true);
		expect(HEADS_THE_VALUE_ALONE.test(`Rivelato ${VALUE}`)).toBe(true);
		// A noun in front of the gendered word is the fix, so both of this issue's new
		// shapes have to read as clean.
		expect(HEADS_THE_VALUE_ALONE.test(`Proposta accettata: ${VALUE}`)).toBe(false);
		expect(HEADS_THE_VALUE_ALONE.test(`Rivelazione al gruppo: ${VALUE} \u00b7 X`)).toBe(false);
		// And so does every line where the gendered word opens a longer sentence whose
		// subject the surface fixes and the sentence never names. These are real catalogue
		// lines, and they are the reason this rule reads the whole line rather than its
		// first word.
		expect(HEADS_THE_VALUE_ALONE.test(`derivato da ${VALUE}`)).toBe(false);
		expect(HEADS_THE_VALUE_ALONE.test(`usata l'ultima volta il ${VALUE}`)).toBe(false);
		expect(HEADS_THE_VALUE_ALONE.test(`Gi\u00e0 spesi: ${VALUE} cr su questo piano`)).toBe(false);
		// A fragment hung under an entry card whose name is already on screen: lower case is
		// how the catalogue says the subject is elsewhere, and both of these are real lines
		// (`universe.index.changedAt`, `works.node.changedAt`) that agree with "la voce"
		// correctly.
		expect(HEADS_THE_VALUE_ALONE.test(`cambiata ${VALUE}`)).toBe(false);
		expect(HEADS_THE_VALUE_ALONE.test(`modificata: ${VALUE}`)).toBe(false);
		// A heading with nothing interpolated under it is out of scope: this rule is only
		// about a gendered word whose only possible subject is a value.
		expect(HEADS_THE_VALUE_ALONE.test('Accettata')).toBe(false);
	});

	test('never leaves a gendered word alone over an interpolated label', () => {
		const offenders = lines
			.filter(([key]) => !(key in REFERENT_IS_FIXED))
			.filter(([, line]) => HEADS_THE_VALUE_ALONE.test(line));
		expect(offenders.map(([key, line]) => `${key}: ${line}`)).toEqual([]);
	});

	test('the accepted toast names the proposal rather than agreeing with the entry', () => {
		// Guardrail on the shape, the same way the table failure toast has one: the noun
		// comes first in both branches, so the name that follows governs nothing and the
		// no-name branch needs no noun of its own.
		const toast = itMessages.proposals.queue.acceptedToast;
		expect(toast(VALUE)).toBe(`Proposta accettata: ${VALUE}`);
		expect(toast(null)).toBe('Proposta accettata');
		// The counts beside it are the opposite case and stay feminine on purpose: the noun
		// they agree with is "proposte", which this queue fixes, and the count they agree
		// with is the one they were handed.
		expect(itMessages.proposals.queue.acceptedSuffix(1).trim()).toBe('accettata');
		expect(itMessages.proposals.queue.acceptedSuffix(2).trim()).toBe('accettate');
		expect(itMessages.proposals.queue.rejectedSuffix(1).trim()).toBe('rifiutata');
		expect(itMessages.proposals.queue.rejectedSuffix(2).trim()).toBe('rifiutate');
	});

	test('the entry aside states a revelation as a noun, not as a participle', () => {
		// Issue #584. These two agree with the entry the panel renders on, which the
		// interpolation-keyed sweep above structurally cannot see: `notRevealed` has no
		// interpolation at all, and `revealedIn`'s arguments are a session name and a date
		// that the participle sits in front of rather than behind. An entry is a "luogo", a
		// "fazione", a "sessione" or a "personaggio", and those do not share a gender, while
		// the same aside calls its subject "la voce", so the two readings of the implied
		// subject disagree and no participle can be right for both. Both lines carry their
		// own noun instead, which is why no gendered word may appear in either.
		const sections = itMessages.entry.sections;
		const gendered = new RegExp(`\\b${GENDERED_WORD}\\b`, 'i');
		expect(sections.notRevealed).toBe('Nessuna rivelazione al gruppo finora');
		expect(gendered.test(sections.notRevealed)).toBe(false);
		expect(gendered.test(sections.revealedIn(VALUE, FILLER))).toBe(false);
		expect(sections.revealedIn(VALUE, FILLER)).toContain('Rivelazione al gruppo');
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
