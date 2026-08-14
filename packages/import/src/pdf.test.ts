import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	PdfPageNotFoundError,
	extractPdfPageTexts,
	extractPdfText,
	formatPdfPageText,
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
