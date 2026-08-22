/**
 * Issue #569: the Italian catalogue may not build a passive on a verb that takes a
 * preposition in Italian.
 *
 * The defect was `shell.quickAsk.disclosure`, the first sentence a GM reads in the dock,
 * which opened "Ogni domanda qui viene risposta e conservata automaticamente". `rispondere`
 * takes `a`, so a `domanda` is not something that can be `risposta` in the passive: the
 * sentence was a word-for-word carry of the English "Every question here is answered and
 * kept automatically", which is exactly the failure mode SPEC.md §17 and the language page
 * warn about. The same construction had leaked into `universe.ask.disclosure` and
 * `universe.settings.loremasterConversations.text`.
 *
 * This pins the construction rather than the sentence, so a rewording of any of the three
 * stays free while the calque stays out, and so a key added later is covered without
 * anybody remembering to add it here. It walks every string leaf of `it`, functions
 * included where they can be called with sample arguments, because the catalogue's prose
 * lives in both shapes.
 */
import { describe, expect, it as test } from 'vitest';
import { it as itMessages } from './it.js';

/**
 * Passives Italian does not have, because the verb governs a preposition. Each entry is
 * the construction, not a sentence: `venire`/`essere` plus the participle of a verb that
 * cannot take a direct object.
 *
 * `rispondere a` is the one #569 found. `telefonare a`, `giovare a` and `partecipare a`
 * are the same shape and the same trap for a translator working from English, so they are
 * kept here as the class rather than as a prediction that they will appear.
 */
const IMPOSSIBLE_PASSIVES = [
	/\b(?:vien[eo]|veniva|verrà|verranno|vengono|è|sono|era|erano|sarà|saranno)\s+rispost[aeio]\b/i,
	/\b(?:vien[eo]|vengono|è|sono)\s+telefonat[aeio]\b/i,
	/\b(?:vien[eo]|vengono|è|sono)\s+giovat[aeio]\b/i,
	/\b(?:vien[eo]|vengono|è|sono)\s+partecipat[aeio]\b/i
];

/** Every string the Italian catalogue can produce, with its key path. A function leaf is
 * called with sample arguments so its template's own prose is read too; one that needs a
 * shape this cannot guess throws, and is skipped rather than failing the sweep. */
function italianStrings(value: unknown, prefix = ''): [string, string][] {
	if (typeof value === 'string') return [[prefix, value]];
	if (typeof value === 'function') {
		const samples: unknown[][] = [
			['Aldric Vane', 'Cairnmouth', 'un capitano'],
			[1, 2, 3],
			[1, 'Cairnmouth', 2],
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

describe('the Italian catalogue (issue #569)', () => {
	const strings = italianStrings(itMessages);

	test('reads more than a handful of strings, so a green run means something', () => {
		expect(strings.length).toBeGreaterThan(400);
	});

	test('never builds a passive on a verb that takes a preposition', () => {
		const offenders = strings.filter(([, line]) =>
			IMPOSSIBLE_PASSIVES.some((pattern) => pattern.test(line))
		);
		expect(offenders.map(([key, line]) => `${key}: ${line}`)).toEqual([]);
	});

	test('the dock disclosure still says a question gets an answer', () => {
		// Guardrail 5: the sentence has to stay true as well as grammatical, so the two
		// facts it carries are pinned by their own words rather than by the whole line.
		const disclosure = itMessages.shell.quickAsk.disclosure;
		expect(disclosure).toMatch(/risposta/i);
		expect(disclosure).toMatch(/conservat/i);
	});
});
