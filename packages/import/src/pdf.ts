/**
 * PDF handling for issue #39 (SPEC.md §6.3, §6.6): per-page text extraction through
 * `pdfjs-dist`'s own text layer, and page rasterisation for `page_image` when a page
 * has no text layer at all - "a scanned page is simply looked at... local and
 * deterministic: no OCR provider, no per-page fee, no third party" (SPEC.md §6.3, §6.6).
 *
 * Both halves are pure functions over PDF bytes; wiring them into a real
 * `SourceReader.read`/`renderPage` for one archive entry is issue #25's job
 * (`ArchiveSourceReader`), not this file's - this module only has to be correct on its
 * own, and cheap to call from there.
 */
// `pdfjs-dist` is imported lazily, inside `openDocument`, and this is load-bearing rather
// than tidiness. Its module top level touches browser globals (`DOMMatrix`) and probes for
// its optional `@napi-rs/canvas` peer, so merely importing this file crashes a Node server
// that has neither: every SvelteKit route whose server module transitively reached
// `@canonry/import` answered 500 in production while /healthz stayed green, because health
// never imports the import engine. Nothing outside a running import job needs pdfjs, so
// nothing outside one should pay to load it.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
	RenderParameters,
	TextItem,
	TextMarkedContent
} from 'pdfjs-dist/types/src/display/api.js';
import type { RenderedPage } from './sources.js';

export class PdfParseError extends Error {
	constructor(cause: unknown) {
		super(`failed to parse PDF: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = 'PdfParseError';
	}
}

export class PdfPageNotFoundError extends Error {
	constructor(page: number, pageCount: number) {
		super(`page ${page} does not exist - this PDF has ${pageCount} page(s)`);
		this.name = 'PdfPageNotFoundError';
	}
}

/** Caps total pixels pdf.js will rasterise for any one embedded image while rendering
 * a page (`getDocument`'s own `maxImageSize` option) - a defense against a
 * decompression-bomb image embedded in a malicious PDF's own content stream, distinct
 * from media-store.ts's guard on images extracted separately through `image_store`. */
const PDF_MAX_EMBEDDED_IMAGE_PIXELS = 64_000_000;

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
	return 'hasEOL' in item;
}

/**
 * Reconstructs one page's text from pdf.js's text items. `hasEOL` (set by pdf.js from
 * the PDF's own layout, not guessed here) draws every line break; a horizontal-gap
 * heuristic adds a space between two items on the same line that pdf.js split without
 * one (common when a font or kerning table changes mid-word), because pdf.js never
 * inserts whitespace on its own - only `str` content and line breaks.
 */
function joinTextItems(items: readonly TextItem[]): string {
	let text = '';
	let prevEndX: number | null = null;
	let prevY: number | null = null;
	for (const item of items) {
		const y = item.transform[5];
		const sameLine = prevY !== null && Math.abs(y - prevY) < 0.5;
		if (sameLine && prevEndX !== null && item.str.length > 0) {
			const gap = item.transform[4] - prevEndX;
			const fontSize = Math.hypot(item.transform[2], item.transform[3]);
			const needsSpace =
				gap > fontSize * 0.15 &&
				!text.endsWith(' ') &&
				!text.endsWith('\n') &&
				!item.str.startsWith(' ');
			if (needsSpace) text += ' ';
		}
		text += item.str;
		if (item.hasEOL) text += '\n';
		prevEndX = item.transform[4] + item.width;
		prevY = y;
	}
	// Trailing EOLs only matter mid-page; `formatPdfPageText` supplies the blank line
	// between pages itself, so a trailing newline here would double it up.
	return text.replace(/\n+$/, '');
}

interface OpenedPdfDocument {
	doc: PDFDocumentProxy;
	close(): Promise<void>;
}

async function openDocument(bytes: Uint8Array): Promise<OpenedPdfDocument> {
	const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const loadingTask = pdfjsLib.getDocument({
		// `getDocument`'s own docs: a `Uint8Array` passed as `data` "will generally be
		// transferred to the worker-thread", detaching the caller's buffer. Copying here
		// keeps `bytes` reusable by the caller - `extractPdfText` and `renderPdfPage` are
		// called independently, often on the same bytes (once per scanned page looked at).
		// `new Uint8Array(bytes)` always copies; `bytes.slice()` would not if `bytes` is a
		// Node `Buffer`, whose `slice()` is overridden to alias the same memory.
		data: new Uint8Array(bytes),
		useSystemFonts: true,
		maxImageSize: PDF_MAX_EMBEDDED_IMAGE_PIXELS
	});
	try {
		const doc = await loadingTask.promise;
		return { doc, close: () => loadingTask.destroy() };
	} catch (cause) {
		await loadingTask.destroy();
		throw new PdfParseError(cause);
	}
}

/** One entry per page, in order, page 1 first. An empty string means the page carried
 * no text layer at all - the playbook's signal (pdf.md step 1) to call `page_image`. */
export async function extractPdfPageTexts(bytes: Uint8Array): Promise<string[]> {
	const { doc, close } = await openDocument(bytes);
	try {
		const pages: string[] = [];
		for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
			const page = await doc.getPage(pageNumber);
			try {
				const textContent = await page.getTextContent();
				pages.push(joinTextItems(textContent.items.filter(isTextItem)));
			} finally {
				page.cleanup();
			}
		}
		return pages;
	} finally {
		await close();
	}
}

/** The exact join `playbooks/pdf.md` documents: "the text of every page is
 * concatenated with a `--- page N ---` marker between pages". */
export function formatPdfPageText(pageTexts: readonly string[]): string {
	return pageTexts.map((text, index) => `--- page ${index + 1} ---\n${text}`).join('\n\n') + '\n';
}

export interface PdfTextExtraction {
	/** The full `source_read` payload: every page's text, `--- page N ---`-joined. */
	text: string;
	/** Per-page text, 0-indexed by array position but 1-indexed in `text`'s markers. */
	pageTexts: string[];
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtraction> {
	const pageTexts = await extractPdfPageTexts(bytes);
	return { text: formatPdfPageText(pageTexts), pageTexts };
}

/**
 * What OneNote prints at the bottom of every page: the name of the **section** the page
 * belongs to, a word for "page" in whatever language the app runs in, and a page number
 * running across the whole print. Issue #604 keys on the section name.
 */
export interface OneNotePrintedFooter {
	/** Everything before the page word, which is the section's own name. */
	section: string;
	/** The page word itself, kept because it is the anchor: two footers of the same print
	 * always agree on it, and a line that is not a footer almost never matches twice. */
	pageWord: string;
	number: number;
}

/**
 * Reads that footer out of one printed line. Deliberately not keyed on "Pagina" or
 * "Page": OneNote prints the word in its own UI language, and the corpus
 * (`docs/corpus-onenote.md`) is an Italian install, so keying on either would work on
 * exactly one language's exports. What is language-independent is the shape, a name then
 * one word then a number, and the caller compares two footers of the same file rather
 * than trusting one on its own.
 */
export function parseOneNotePrintedFooter(line: string): OneNotePrintedFooter | null {
	const match = /^(\S.*?)\s+(\S+)\s+(\d{1,6})$/.exec(line.trim());
	if (!match) return null;
	return { section: match[1]!, pageWord: match[2]!, number: Number(match[3]) };
}

/** The bottom-most line of text on a page: the items with the lowest baseline, in reading
 * order. Taken from the baseline rather than from `joinTextItems`'s line breaks because a
 * footer is defined by where it sits on the paper, and `hasEOL` is pdf.js's own reading of
 * a layout rather than a position. */
function bottomLine(items: readonly TextItem[]): string {
	let lowest: number | null = null;
	for (const item of items) {
		if (item.str.trim() === '') continue;
		const y = item.transform[5];
		if (lowest === null || y < lowest) lowest = y;
	}
	if (lowest === null) return '';
	return items
		.filter((item) => item.str.trim() !== '' && Math.abs(item.transform[5] - lowest) < 1)
		.sort((a, b) => a.transform[4] - b.transform[4])
		.map((item) => item.str)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function printedFooterOfPage(
	doc: PDFDocumentProxy,
	pageNumber: number
): Promise<OneNotePrintedFooter | null> {
	const page = await doc.getPage(pageNumber);
	try {
		const textContent = await page.getTextContent();
		return parseOneNotePrintedFooter(bottomLine(textContent.items.filter(isTextItem)));
	} finally {
		page.cleanup();
	}
}

/**
 * Whether a PDF OneNote printed covers **more than one section** of its notebook, which
 * is the only in-file evidence that the GM exported at notebook scope rather than a
 * section at a time (issue #604, `docs/onenote-export.md`). It matters because the
 * notebook-scope export drops pages the section-scope one keeps.
 *
 * Two pages are read, the first and the last, not all of them: the sections print as
 * contiguous runs, so the first and last page of a notebook print name different sections
 * and those of a section print name the same one. On the corpus that is 3 seconds of
 * pdf.js for the whole 161-page file against under a second for two pages, on a path that
 * runs while a GM waits for a confirm screen.
 *
 * It answers false whenever the evidence is not there, and that direction is deliberate:
 * the footer has to parse on both pages, the two have to agree on the page word (so a body
 * line that happens to end in a number cannot pass for a footer twice), and the first
 * page's number has to be 1. A file whose footers this does not understand gets no claim
 * made about it, because guardrail 7 makes silence the safe answer and an unwanted warning
 * on a section export the GM did right would be the expensive one.
 */
export async function printedNotebookCoversManySections(bytes: Uint8Array): Promise<boolean> {
	const { doc, close } = await openDocument(bytes);
	try {
		if (doc.numPages < 2) return false;
		const first = await printedFooterOfPage(doc, 1);
		if (!first || first.number !== 1) return false;
		const last = await printedFooterOfPage(doc, doc.numPages);
		if (!last || last.pageWord !== first.pageWord) return false;
		return last.section !== first.section;
	} finally {
		await close();
	}
}

/**
 * Render resolution (SPEC.md §6.6's "local and deterministic... rendered to an image
 * and handed to a multimodal model, once"). Two constants, not one, because a page's
 * physical size varies (this module has seen a "page" whose declared size matches a
 * scanned image's pixel dimensions at 72 DPI, i.e. nearly A2):
 *
 * - `PDF_RENDER_TARGET_DPI` (150) is the resolution a normal letter/A4 page renders at.
 *   150 DPI is the low end of the 150-300 DPI band standard OCR/scan pipelines use, and
 *   comfortably resolves book-normal body text for a multimodal model to read; going
 *   higher buys little extra legibility at meaningfully higher token/CPU cost.
 * - `PDF_RENDER_MAX_LONG_EDGE_PX` (1568) caps the long edge in pixels regardless of DPI,
 *   because DPI alone does not bound an oversized page: at 150 DPI an 850x1100pt page
 *   renders past 2000px on a side. 1568 is the long edge Anthropic's vision encoder
 *   resizes an image to internally before it ever reaches the model - rendering past
 *   that produces upload bytes the API discards, not model quality.
 */
export const PDF_RENDER_TARGET_DPI = 150;
export const PDF_RENDER_MAX_LONG_EDGE_PX = 1568;
/** JPEG, not PNG: a rendered page is effectively a photograph (scanned paper, printed
 * text, sometimes an actual photo), and JPEG compresses that far smaller than PNG for a
 * quality loss no multimodal model call will notice - this fixture's page 2 renders to
 * about half the bytes as JPEG at this quality than as PNG. */
export const PDF_RENDER_JPEG_QUALITY = 85;

/** A `@napi-rs/canvas` canvas, typed to just the method this module calls. Not imported
 * from `@napi-rs/canvas` directly: that package is `pdfjs-dist`'s own optional
 * dependency (resolved from *its* `node_modules`, per `NodeCanvasFactory`'s internal
 * `require`), not a direct dependency of this package - adding one needs `pnpm install`. */
interface NodeCanvasLike {
	toBuffer(mimeType: 'image/jpeg', quality: number): Buffer;
}

interface NodeCanvasFactoryLike {
	create(width: number, height: number): { canvas: unknown; context: unknown };
	destroy(entry: { canvas: unknown; context: unknown }): void;
}

/** `PDFPageProxy.render`'s own declared parameter type, imported directly from pdf.js's
 * `display/api` module (not re-exported from the `pdfjs-dist` package root). It is
 * expressed in terms of DOM lib types (`HTMLCanvasElement`, `CanvasRenderingContext2D`)
 * this package's `tsconfig` does not include (Node has no DOM); pdf.js selects
 * `@napi-rs/canvas`'s drop-in, DOM-shaped implementations for Node, so a value of this
 * type is satisfied structurally without the DOM lib. */
type PdfRenderParameters = RenderParameters;

export async function renderPdfPage(bytes: Uint8Array, pageNumber: number): Promise<RenderedPage> {
	const { doc, close } = await openDocument(bytes);
	try {
		if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
			throw new PdfPageNotFoundError(pageNumber, doc.numPages);
		}
		const page = await doc.getPage(pageNumber);
		try {
			const unscaled = page.getViewport({ scale: 1 });
			const longEdgePt = Math.max(unscaled.width, unscaled.height);
			const scale = Math.min(PDF_RENDER_TARGET_DPI / 72, PDF_RENDER_MAX_LONG_EDGE_PX / longEdgePt);
			const viewport = page.getViewport({ scale });
			const width = Math.max(1, Math.round(viewport.width));
			const height = Math.max(1, Math.round(viewport.height));

			// `doc.canvasFactory` is pdf.js's own Node canvas factory, auto-selected because
			// it detects a Node environment - the same factory pdf.js's own Node rendering
			// example uses, so this module never imports a canvas implementation itself. Its
			// declared type is a bare `Object`, so the structural shape below is asserted once
			// here rather than inferred - the compiler has no way to know it from `Object`.
			const canvasFactory = doc.canvasFactory as unknown as NodeCanvasFactoryLike;
			const canvasAndContext = canvasFactory.create(width, height);
			try {
				const canvasContext =
					canvasAndContext.context as unknown as PdfRenderParameters['canvasContext'];
				const canvas = canvasAndContext.canvas as unknown as PdfRenderParameters['canvas'];
				await page.render({ canvasContext, canvas, viewport }).promise;
				// Same canvas, read back as the `@napi-rs/canvas` shape this module actually
				// needs (`toBuffer`), which its DOM-shaped render-time type does not declare.
				const napiCanvas = canvasAndContext.canvas as unknown as NodeCanvasLike;
				const buffer = napiCanvas.toBuffer('image/jpeg', PDF_RENDER_JPEG_QUALITY);
				return { mimeType: 'image/jpeg', base64: buffer.toString('base64'), width, height };
			} finally {
				canvasFactory.destroy(canvasAndContext);
			}
		} finally {
			page.cleanup();
		}
	} finally {
		await close();
	}
}
