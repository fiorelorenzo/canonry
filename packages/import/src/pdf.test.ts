import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	PdfPageNotFoundError,
	extractPdfPageTexts,
	extractPdfText,
	formatPdfPageText,
	parseOneNotePrintedFooter,
	printedNotebookCoversManySections,
	renderPdfPage
} from './pdf.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../test/fixtures/pdf/', import.meta.url));

/**
 * `handout.pdf` (checked in by issue #46's fixture work) is a real 2-page PDF: page 1
 * has a genuine text layer, page 2 is a full-page scanned image with no text layer at
 * all. `handout.expected-text.txt` is `pdftotext`'s own output for page 1, reformatted
 * into the `--- page N ---` convention `playbooks/pdf.md` documents - this test proves
 * this module's own extraction reproduces it byte for byte, not the other way round.
 */
async function loadHandout(): Promise<Uint8Array> {
	return new Uint8Array(await readFile(`${FIXTURE_ROOT}handout.pdf`));
}

describe('extractPdfText (issue #39, SPEC.md §6.3)', () => {
	it('matches the documented --- page N --- convention exactly, byte for byte', async () => {
		const bytes = await loadHandout();
		const expected = await readFile(`${FIXTURE_ROOT}handout.expected-text.txt`, 'utf8');

		const { text, pageTexts } = await extractPdfText(bytes);

		expect(text).toBe(expected);
		expect(pageTexts).toHaveLength(2);
	});

	it('extracts a real text layer for the page that has one', async () => {
		const bytes = await loadHandout();
		const pages = await extractPdfPageTexts(bytes);
		expect(pages[0]).toContain('The Sunken Archive is a flooded lower level');
	});

	it("returns an empty string for a page with no text layer at all - the playbook's signal to call page_image", async () => {
		const bytes = await loadHandout();
		const pages = await extractPdfPageTexts(bytes);
		expect(pages[1]).toBe('');
	});

	it('formats pages with blank-line-separated --- page N --- markers', () => {
		expect(formatPdfPageText(['first', ''])).toBe('--- page 1 ---\nfirst\n\n--- page 2 ---\n\n');
	});

	it("extracting text never rasterises anything - it only walks the text layer, so a page's size does not bound how expensive extraction is", async () => {
		// Regression guard for "a page with a text layer must not be rendered needlessly":
		// this only calls the text-extraction half, and it must resolve without ever
		// touching a canvas factory - there is nothing in `extractPdfPageTexts` that could
		// render, so this test is really documentation with a real assertion attached.
		const bytes = await loadHandout();
		const start = performance.now();
		await extractPdfPageTexts(bytes);
		// A real rasterisation of an 850x1100pt page at 150 DPI takes long enough that this
		// generous ceiling still catches an accidental render being added to this path.
		expect(performance.now() - start).toBeLessThan(2000);
	});
});

describe('renderPdfPage (issue #39, SPEC.md §6.6)', () => {
	it('renders the scanned page (no text layer) to a legible, budget-sized JPEG', async () => {
		const bytes = await loadHandout();
		const rendered = await renderPdfPage(bytes, 2);

		expect(rendered.mimeType).toBe('image/jpeg');
		const buffer = Buffer.from(rendered.base64, 'base64');
		// This fixture's page 2 is nearly A2 at 72 DPI (850x1100pt) - proves the long-edge
		// clamp actually engages, not just the DPI scale.
		expect(rendered.width).toBeLessThanOrEqual(1568);
		expect(rendered.height).toBeLessThanOrEqual(1568);
		expect(Math.max(rendered.width, rendered.height)).toBe(1568);
		// A real JPEG at quality 85 for this page - not a placeholder-sized stub, not an
		// unbounded multi-megabyte upload either.
		expect(buffer.byteLength).toBeGreaterThan(10_000);
		expect(buffer.byteLength).toBeLessThan(500_000);
		// JPEG magic bytes (FF D8 FF), proving these are real encoded image bytes.
		expect(buffer[0]).toBe(0xff);
		expect(buffer[1]).toBe(0xd8);
		expect(buffer[2]).toBe(0xff);
	});

	it("can also render a page that does have a text layer - rendering is available on any page; skipping it for a text page is the playbook/tool caller's decision (pdf.md step 1-2), not this function's", async () => {
		const bytes = await loadHandout();
		const rendered = await renderPdfPage(bytes, 1);
		expect(rendered.mimeType).toBe('image/jpeg');
		expect(rendered.width).toBeGreaterThan(0);
		expect(rendered.height).toBeGreaterThan(0);
	});

	it("rejects a page number past the document's own page count with a named error", async () => {
		const bytes = await loadHandout();
		await expect(renderPdfPage(bytes, 99)).rejects.toThrow(PdfPageNotFoundError);
	});

	it('extractPdfText and renderPdfPage can both run against the same bytes, in either order', async () => {
		// pdf.js's own docs warn that a Uint8Array `data` "will generally be transferred to
		// the worker-thread" (i.e. detached) - a real bug this test caught: rendering after
		// extracting the same bytes threw "Cannot transfer object of unsupported type."
		const bytes = await loadHandout();
		const extraction = await extractPdfText(bytes);
		const rendered = await renderPdfPage(bytes, 2);
		expect(extraction.pageTexts).toHaveLength(2);
		expect(rendered.mimeType).toBe('image/jpeg');
	});
});

/**
 * Issue #604. OneNote's whole-notebook export drops pages its section-scope export keeps,
 * so the confirm screen needs to know which scope a print came from, and the printed
 * footer is the only thing in the file that says: OneNote writes the **section's** name
 * into every page's footer, never the notebook's. Measured on the corpus
 * (`docs/corpus-onenote.md`): the notebook-scope print's 161 footers name three sections
 * (80 pages of one, 39 of another, 42 of a third) and each section-scope print's footers
 * name exactly one.
 *
 * The two fixtures reproduce that and nothing else, and they deliberately disagree on the
 * word between the name and the number, because keying on "Pagina" or "Page" would work
 * on exactly one language's exports.
 */
const ONENOTE_FIXTURES = fileURLToPath(
	new URL('../test/fixtures/onenote-formats/', import.meta.url)
);

describe('parseOneNotePrintedFooter (issue #604)', () => {
	it('splits a footer into the section name, the page word and the number', () => {
		expect(parseOneNotePrintedFooter('Note Storia Pagina 1')).toEqual({
			section: 'Note Storia',
			pageWord: 'Pagina',
			number: 1
		});
		expect(parseOneNotePrintedFooter('Ashenport Page 12')).toEqual({
			section: 'Ashenport',
			pageWord: 'Page',
			number: 12
		});
	});

	it('reads a section name that is one word, which is the common case', () => {
		expect(parseOneNotePrintedFooter('Mondo Pagina 49')?.section).toBe('Mondo');
	});

	it('answers null for a line that is not a footer at all', () => {
		expect(parseOneNotePrintedFooter('Warden Iset Nour')).toBeNull();
		expect(parseOneNotePrintedFooter('')).toBeNull();
		expect(parseOneNotePrintedFooter('42')).toBeNull();
	});
});

describe('printedNotebookCoversManySections (issue #604)', () => {
	async function fixture(name: string): Promise<Uint8Array> {
		return new Uint8Array(await readFile(`${ONENOTE_FIXTURES}${name}`));
	}

	it('says so when the first and last page footers name different sections', async () => {
		expect(
			await printedNotebookCoversManySections(await fixture('printed-notebook-scope.pdf'))
		).toBe(true);
	});

	it('stays quiet on a print of one section, whatever language the footer is in', async () => {
		// The section fixture's footer word is English and the notebook fixture's is
		// Italian, so a pair of green assertions here is also the proof that neither answer
		// comes from recognising the word.
		expect(
			await printedNotebookCoversManySections(await fixture('printed-section-scope.pdf'))
		).toBe(false);
	});

	it('stays quiet on a one-page print, which cannot span anything', async () => {
		expect(await printedNotebookCoversManySections(await fixture('printed.pdf'))).toBe(false);
	});

	it('stays quiet on a PDF whose bottom line is prose rather than a footer', async () => {
		// Guardrail 7 in the shape it takes here: a body line ending in a number can parse
		// as a footer once, so the claim needs both pages to agree on the page word and the
		// first of them to be page 1. `handout.pdf` is a real PDF nothing printed from
		// OneNote, and its second page has no text layer at all.
		expect(await printedNotebookCoversManySections(await loadHandout())).toBe(false);
	});
});
