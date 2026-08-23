/**
 * Issue #604, guardrails 5 and 7: what the product is allowed to say about OneNote's
 * whole-notebook export, and what it may not.
 *
 * The finding is a content loss rather than a structure loss. Against the union of the two
 * section-scope exports of one real notebook (`docs/onenote-export.md`,
 * `docs/corpus-onenote.md`), the notebook-scope export of the same format is missing 7.9
 * per cent of the tokens as `.mht` and as `.pdf` and 0.0 per cent as `.xps`, and at page
 * level 22 of those 75 pages have not one 8-word phrase anywhere in the notebook-scope
 * file. The file is well formed and imports cleanly, so nothing after the upload can see
 * it: the guide and the confirm screen are the only places the GM can be told.
 *
 * Two things have to stay true at once, which is why this file exists rather than a
 * snapshot of the sentences.
 *
 * **Guardrail 5, the claim that has to be there.** The advice is "export a section at a
 * time", in both locales, on the guide and on the confirm screen, and no line beside it may
 * say the import got everything. `printed-notebook` used to open "OneNote printed this
 * PDF, so every page is here": true of the two section-scope prints in the corpus, false of
 * the notebook-scope one, and a completeness promise on an export that was not complete is
 * exactly the shape guardrail 5 forbids. That half of this file is what keeps it out.
 *
 * **Guardrail 7, the claim that may not be there.** 7.9 per cent is one notebook, not a
 * law, and which pages went missing is not in the file. So no line may carry a share, a
 * count of missing pages, or a promise that what did arrive is all of it. A percentage in
 * this copy would read as a measurement of the GM's own notebook, which it never is.
 *
 * Structural rather than sentence-pinned, the same reason
 * `$lib/ask/no-sources-disclosure.test.ts` reads the markup: a rewording has to stay free
 * while the claim and the prohibition both hold.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it as test } from 'vitest';
import { IMPORT_GUIDES } from '$lib/components/docs/importGuides.js';
import { en } from '$lib/i18n/en.js';
import { it as itMessages } from '$lib/i18n/it.js';
import type { DetectedNotice } from '$lib/i18n/messages.js';

const LOCALES = [
	['en', en],
	['it', itMessages]
] as const;

/** Every notice the confirm screen can paint about a OneNote upload. */
const ONENOTE_NOTICES: DetectedNotice[] = [
	'printed-notebook',
	'printed-many-sections',
	'onenote-scope-unknown'
];

/** The advice itself, per locale: a section at a time, said in words a GM would recognise
 * from OneNote's own menus. Two patterns per locale so a rewording can move either. */
const SECTION_AT_A_TIME = {
	en: [/one section at a time|each section/i, /section/i],
	it: [/una sezione alla volta|ogni sezione/i, /sezione/i]
} as const;

/**
 * A claim that the import got everything. Both the English shape the old
 * `printed-notebook` line had and its Italian twin, plus the neighbouring ways of saying
 * it, because the defect is the promise and not the wording it arrived in.
 */
const COMPLETENESS_CLAIMS = [
	/every page is (?:here|there)/i,
	/all (?:the )?pages are (?:here|there)/i,
	/nothing (?:is )?missing/i,
	/the whole notebook is here/i,
	/ci sono tutte le pagine/i,
	/tutte le pagine (?:ci )?sono/i,
	/non manca (?:niente|nulla)/i
];

/** A number pretending to be a measurement of the reader's own notebook. Any percentage,
 * and any count of pages said to be missing. */
const MEASUREMENT_CLAIMS = [
	/\d+(?:[.,]\d+)?\s*(?:%|per cent|percento)/i,
	/\d+\s+(?:pages?|pagine?)\s+(?:are\s+)?(?:missing|mancan|mancant)/i,
	/(?:missing|mancano)\s+\d+\s+(?:pages?|pagine?)/i
];

/** The OneNote guide's own text, flattened: every block of every section, in order. */
function guideLines(): string[] {
	const guide = IMPORT_GUIDES.find((candidate) => candidate.slug === 'onenote');
	if (!guide) throw new Error('the OneNote import guide is gone');
	return [
		guide.summary,
		...guide.sections.flatMap((section) => [
			section.heading,
			...section.blocks.flatMap((block) => (block.kind === 'list' ? block.items : [block.text]))
		])
	];
}

describe('the advice about OneNote export scope (issue #604)', () => {
	for (const [locale, catalogue] of LOCALES) {
		const notices = ONENOTE_NOTICES.map(
			(notice) => [notice, catalogue.import.upload.confirm.notice(notice)] as const
		);

		test(`${locale}: the two scope notices tell the GM to export a section at a time`, () => {
			for (const notice of ['printed-many-sections', 'onenote-scope-unknown'] as const) {
				const line = notices.find(([kind]) => kind === notice)?.[1] ?? '';
				expect(line.length).toBeGreaterThan(0);
				for (const pattern of SECTION_AT_A_TIME[locale]) expect(line).toMatch(pattern);
			}
		});

		test(`${locale}: no notice claims the import got every page`, () => {
			for (const [kind, line] of notices) {
				for (const claim of COMPLETENESS_CLAIMS) {
					expect(claim.test(line), `${kind}: ${line}`).toBe(false);
				}
			}
		});

		test(`${locale}: no notice puts a number on what is missing`, () => {
			for (const [kind, line] of notices) {
				for (const claim of MEASUREMENT_CLAIMS) {
					expect(claim.test(line), `${kind}: ${line}`).toBe(false);
				}
			}
		});

		test(`${locale}: the three notices are three different sentences`, () => {
			expect(new Set(notices.map(([, line]) => line)).size).toBe(notices.length);
		});
	}

	test('the guide leads with a section at a time, and says why', () => {
		const lines = guideLines();
		const handIt = lines.join('\n');
		for (const pattern of SECTION_AT_A_TIME.en) expect(handIt).toMatch(pattern);
		// The reason, not only the instruction: an instruction with no reason behind it is
		// the kind of advice a GM overrides on the first inconvenience.
		expect(handIt).toMatch(/leaves? pages out|drops? pages|pages? .{0,30}left out/i);
		// And the advice has to be in the section a GM reads before exporting, not only in
		// the limits at the bottom.
		const whatToHand = lines
			.slice(lines.indexOf('What to hand Canonry'))
			.slice(0, lines.indexOf('What it recognises') - lines.indexOf('What to hand Canonry'));
		expect(whatToHand.join('\n')).toMatch(SECTION_AT_A_TIME.en[0]);
	});

	test('the guide claims no share and no page count of its own', () => {
		for (const line of guideLines()) {
			for (const claim of MEASUREMENT_CLAIMS) expect(claim.test(line), line).toBe(false);
			for (const claim of COMPLETENESS_CLAIMS) expect(claim.test(line), line).toBe(false);
		}
	});

	test('the confirm screen paints every notice it is given, not just the first', () => {
		// The structural half, same technique as `$lib/ask/no-sources-disclosure.test.ts`:
		// a printed notebook carries two notices at once, so a surface that renders one and
		// drops the rest would silently lose the scope warning behind the structure one, and
		// `pnpm --filter web test` has no rendered component to assert against.
		const surfaces = {
			onboarding: '../../routes/onboarding/import/+page.svelte',
			universe: '../../routes/w/[universe]/import/+page.svelte'
		};
		for (const [name, path] of Object.entries(surfaces)) {
			const markup = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf-8');
			expect(markup, name).toMatch(/\{#each\s+form\.notices\s+as\s+notice/);
			expect(markup, name).not.toMatch(/\{#if\s+form\.notice\b/);
		}
	});
});
