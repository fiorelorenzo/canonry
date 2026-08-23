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

	// issue #623: the import narrowed to PNG/JPEG/WebP, so an export carrying a GIF or an
	// SVG loses it. That is only acceptable if the GM is told, in their own locale, which
	// picture went and why - the refusal itself reaches only the model's tool result.
	vitestIt('a skipped image names the file and its format, in both locales', () => {
		const raw = JSON.stringify({
			v: 1,
			kind: 'finished',
			documents: 1,
			proposals: 2,
			skippedImages: { path: 'images/sigil.gif', format: 'image/gif', count: 1 }
		});

		const it = renderOutcomeNote('it', raw);
		expect(it).toContain('1 documento elaborato, 2 proposte generate;');
		expect(it).toContain('1 immagine non è stata salvata');
		expect(it).toContain('images/sigil.gif (image/gif)');

		const en = renderOutcomeNote('en', raw);
		expect(en).toContain('1 image was not stored');
		expect(en).toContain('images/sigil.gif (image/gif)');
	});

	vitestIt(
		'several skipped images name the first and count the rest, not an unbounded list',
		() => {
			const raw = JSON.stringify({
				v: 1,
				kind: 'finished',
				documents: 4,
				proposals: 9,
				skippedImages: { path: 'images/sigil.gif', format: 'image/gif', count: 3 }
			});
			expect(renderOutcomeNote('en', raw)).toContain(
				'3 images were not stored because Canonry does not keep those formats: ' +
					'images/sigil.gif (image/gif) and 2 others'
			);
			expect(renderOutcomeNote('it', raw)).toContain(
				'3 immagini non sono state salvate perché Canonry non conserva quei formati: ' +
					'images/sigil.gif (image/gif) e 2 altre'
			);
		}
	);

	// Both suffixes answer different questions and a job can do both, so neither may
	// swallow the other - #212's `lossy` was the only suffix when it was written.
	vitestIt('a job that both lost tool calls and skipped an image reports both', () => {
		const raw = JSON.stringify({
			v: 1,
			kind: 'finished',
			documents: 2,
			proposals: 3,
			lossy: { path: 'notes/g.md', count: 1, othersCount: 0 },
			skippedImages: { path: 'images/sigil.svg', format: 'image/svg+xml', count: 1 }
		});
		const rendered = renderOutcomeNote('en', raw);
		expect(rendered).toContain('notes/g.md lost 1 tool call');
		expect(rendered).toContain('images/sigil.svg (image/svg+xml)');
		expect(rendered?.split('; ').length).toBe(3);
	});
});
