/**
 * issue #263: `import_job.outcome_note` is a `{ v: 1, kind, ... }` payload now
 * (`job-runner.ts`'s `buildOutcomeNote`), rendered in the reader's locale here rather
 * than stored as an already-English sentence. Two things to prove: the Italian catalogue
 * actually renders Italian for each payload shape, and a note written before this issue
 * (plain English, not JSON) still renders as sensible text instead of throwing or coming
 * back empty.
 */
import { describe, expect, it as vitestIt } from 'vitest';
import { renderOutcomeNote } from './outcome-note.js';

describe('renderOutcomeNote (issue #263)', () => {
	vitestIt('a finished job with no issues reads as a plain Italian sentence', () => {
		const raw = JSON.stringify({ v: 1, kind: 'finished', documents: 3, proposals: 5 });
		const rendered = renderOutcomeNote('it', raw);
		expect(rendered).toBe('3 documenti elaborati, 5 proposte generate');
	});

	vitestIt(
		'the ceiling-stop banner from the issue itself renders as Italian, not the stored English detail',
		() => {
			const raw = JSON.stringify({
				v: 1,
				kind: 'offender',
				offender: {
					path: 'valdris Campaign/Settlements/Millbrook.htm',
					reason: 'step_worst_case_exceeds_budget',
					othersCount: 2
				}
			});
			const rendered = renderOutcomeNote('it', raw);
			expect(rendered).toBe(
				'valdris Campaign/Settlements/Millbrook.htm: il costo massimo di questo passo non entra ' +
					'nel budget di credito rimasto per questo import (e altri 2 documenti che non sono ' +
					'finiti correttamente)'
			);
			expect(rendered).not.toContain('worst case');
			expect(rendered).not.toContain('remaining credit budget');
		}
	);

	vitestIt('a lossy suffix attaches after the base sentence, in locale', () => {
		const raw = JSON.stringify({
			v: 1,
			kind: 'finished',
			documents: 1,
			proposals: 1,
			lossy: { path: 'notes/g.md', count: 1, othersCount: 0 }
		});
		const rendered = renderOutcomeNote('it', raw);
		expect(rendered).toContain('1 documento elaborato, 1 proposta generata;');
		expect(rendered).toContain('notes/g.md ha perso 1 chiamata a uno strumento');
	});

	vitestIt(
		'an unrecognised offender reason still renders via the "other" fallback, not a crash',
		() => {
			const raw = JSON.stringify({
				v: 1,
				kind: 'offender',
				offender: {
					path: 'notes/x.md',
					reason: 'other',
					othersCount: 0,
					text: 'something the classifier does not recognise yet'
				}
			});
			expect(() => renderOutcomeNote('it', raw)).not.toThrow();
			expect(renderOutcomeNote('it', raw)).toContain(
				'something the classifier does not recognise yet'
			);
		}
	);

	vitestIt(
		'a note written before this change (plain English, not JSON) still renders as sensible text, not a crash or an empty banner',
		() => {
			const legacy =
				"notes/a.md: this step's worst case would not fit this job's remaining credit budget " +
				'(and 2 other document(s) that did not finish cleanly)';
			expect(() => renderOutcomeNote('it', legacy)).not.toThrow();
			expect(renderOutcomeNote('it', legacy)).toBe(legacy);
			expect(renderOutcomeNote('en', legacy)).toBe(legacy);
		}
	);

	vitestIt('the empty-string column default renders as no note at all, in either locale', () => {
		expect(renderOutcomeNote('it', '')).toBeNull();
		expect(renderOutcomeNote('en', '')).toBeNull();
	});
});
