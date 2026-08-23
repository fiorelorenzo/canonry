/**
 * The real `SourceReader` (issue #25, SPEC.md §6.1, §6.5): "unpack the export, walk it...
 * deterministic code, because it is file handling, and file handling has a right answer."
 * §6.5 spells out the failure mode this file exists to close: "file handling is
 * deterministic code, so a malicious archive meets a zip reader with limits, not a model
 * with imagination - zip bombs, path traversal and absurd file counts are rejected before
 * any model sees them."
 *
 * `ArchiveSourceReader.open` parses and fully validates a zip archive in one synchronous
 * pass before returning anything - there is no path from "an archive that failed a limit"
 * to a reader a document loop can call `source_read` against. Three defenses, all applied
 * from the zip's *central directory* before a single byte is inflated:
 *
 * - entry count, checked against a running counter as the central directory is walked;
 * - a path-traversal check on every entry name (absolute paths, `..` segments, drive
 *   letters, NUL bytes, backslash-separated Windows paths);
 * - a per-entry cap on declared uncompressed size, and a *cumulative* cap tracked across
 *   every entry accepted so far - fflate's synchronous `unzipSync` inflates everything
 *   that is not filtered out in one call, so a thousand one-megabyte entries that each
 *   pass the per-entry cap would still exhaust memory if only the per-entry cap existed.
 *
 * `fflate`'s `unzipSync` reads declared sizes from the central directory (not the
 * possibly-mismatched local file header) and, critically, allocates exactly that many
 * bytes as the inflate destination (`out: new u8(su)` in fflate's own source) - so an
 * entry that lies about its size cannot decompress into more memory than its own
 * declared (and limit-checked) size permits, and an entry that fails any cap is rejected
 * via a thrown error from inside `unzipSync`'s filter callback, before that entry (or any
 * entry after it) is ever inflated.
 *
 * PDF/DOCX handling (issue #39) is wired in here at the two points a document loop
 * actually reaches it: `source_read` on a `.pdf`/`.docx` entry runs `extractPdfText`/
 * `extractDocxText` instead of raw-decoding the bytes as UTF-8, and `renderPage` runs
 * `renderPdfPage` instead of throwing a "not implemented" stub. Getting inside a PDF's
 * own parser is exactly the kind of thing that deserves the same "somebody else's
 * content" suspicion the zip-bomb guards above apply to the archive itself - a PDF that
 * unpacked fine under `maxEntryUncompressedBytes` can still declare a page size or an
 * embedded image that tries to rasterise into gigabytes, so `renderPage` checks the
 * *rendered* page's pixel count and byte size against the same caps `media-store.ts`
 * (issue #40) already enforces on a stored image, rather than trusting `pdf.ts`'s own
 * render-resolution constants to be the only thing standing in the way. And an entry
 * that claims to be a PDF/DOCX by its name and is not one, or is truncated, fails with a
 * named `ArchiveEntryExtractionError` naming the entry - caught by `tools.ts`'s
 * `source_read`/`page_image` handlers into an `{ ok: false }` tool result, not an
 * uncaught exception, so one bad file in a large export costs that one document, never
 * the run.
 */
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { createHash } from 'node:crypto';
import type {
	BinaryAsset,
	RenderedPage,
	SourceEntry,
	SourceReader,
	SourceReadResult
} from './sources.js';
import { SourceNotFoundError } from './sources.js';
import { extractPdfText, renderPdfPage, type PdfTextExtraction } from './pdf.js';
import { extractDocxText, type DocxTextExtraction } from './docx.js';
import { sniffUpload, type UploadSniff } from './upload-format.js';
import {
	DEFAULT_MEDIA_STORE_LIMITS,
	ImageDimensionsTooLargeError,
	ImageTooLargeError
} from './media-store.js';

export class ArchiveTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArchiveTooLargeError';
	}
}

export class TooManyEntriesError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TooManyEntriesError';
	}
}

export class PathTraversalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PathTraversalError';
	}
}

export class ZipBombError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ZipBombError';
	}
}

export class UnsupportedCompressionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedCompressionError';
	}
}

export class ArchiveParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArchiveParseError';
	}
}

export class ArchiveEntryExtractionError extends Error {
	constructor(path: string, kind: 'PDF' | 'DOCX', cause: unknown) {
		super(
			`entry "${path}" claims to be a ${kind} but could not be read: ` +
				`${cause instanceof Error ? cause.message : String(cause)}`
		);
		this.name = 'ArchiveEntryExtractionError';
	}
}

export interface ArchiveLimits {
	/** Raw zip file size, checked before any parsing starts. */
	maxArchiveBytes: number;
	/** Total entry count (files and directories), checked as the central directory is
	 * walked, before the offending entry (or anything after it) is inflated. */
	maxEntries: number;
	/** Declared (central directory) uncompressed size of any one entry. This is also the
	 * hard ceiling on how much any single entry can ever actually inflate to, because
	 * fflate allocates the inflate destination at exactly this declared size. */
	maxEntryUncompressedBytes: number;
	/** Sum of declared uncompressed sizes across every entry accepted so far - fflate's
	 * synchronous API inflates everything the filter accepts in one call, so this is
	 * what actually bounds total memory use, not the per-entry cap alone. */
	maxTotalUncompressedBytes: number;
	/** `source_read`'s own cap (SPEC.md §6.5's "truncated" contract already declared on
	 * `SourceReadResult`), independent of the archive-level caps above. Applies both to a
	 * raw entry's bytes and to text produced by extracting a `.pdf`/`.docx` entry, since
	 * the produced text is not bounded by any of the caps above either. */
	maxTextReadBytes: number;
	/** `renderPage`'s own cap on a rendered PDF page's pixel count - the render-path
	 * equivalent of `media-store.ts`'s `MediaStoreLimits.maxDecodedPixels`. `pdf.ts`'s own
	 * render-resolution constants already keep a normal page well under this, but the
	 * check belongs at this boundary regardless of what the renderer promises: a page
	 * that declares an absurd size is somebody else's content, same as the archive itself. */
	maxRenderedPixels: number;
	/** `renderPage`'s own cap on a rendered page's JPEG byte size - the render-path
	 * equivalent of `media-store.ts`'s `MediaStoreLimits.maxBytes`. */
	maxRenderedBytes: number;
}

/** Conservative production defaults. A 20000-file archive (double `maxEntries`) and a
 * multi-hundred-megabyte declared-size bomb are both rejected well under these. The
 * render-path caps reuse `media-store.ts`'s own stored-image limits exactly - a page
 * rendered out of a PDF and an image stored from an export are the same failure mode. */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
	maxArchiveBytes: 200 * 1024 * 1024,
	maxEntries: 10_000,
	maxEntryUncompressedBytes: 200 * 1024 * 1024,
	maxTotalUncompressedBytes: 500 * 1024 * 1024,
	maxTextReadBytes: 2 * 1024 * 1024,
	maxRenderedPixels: DEFAULT_MEDIA_STORE_LIMITS.maxDecodedPixels,
	maxRenderedBytes: DEFAULT_MEDIA_STORE_LIMITS.maxBytes
};

interface StoredEntry {
	path: string;
	content: Uint8Array;
}

/** Rejects absolute paths, `..` segments, drive letters and NUL bytes, and returns the
 * normalized (forward-slash, no leading slash) path otherwise. Never attempts to
 * "resolve" a `..` down to something safe - any traversal segment is a hard rejection,
 * not a path to sanitize. */
function normalizeEntryPath(rawName: string): string {
	if (rawName.length === 0) {
		throw new PathTraversalError('zip entry has an empty name');
	}
	if (rawName.includes('\0')) {
		throw new PathTraversalError(`zip entry name contains a NUL byte: ${JSON.stringify(rawName)}`);
	}
	const slashed = rawName.replace(/\\/g, '/');
	if (slashed.startsWith('/')) {
		throw new PathTraversalError(`zip entry has an absolute path: "${rawName}"`);
	}
	if (/^[a-zA-Z]:/.test(slashed)) {
		throw new PathTraversalError(`zip entry names a drive: "${rawName}"`);
	}
	const segments = slashed.split('/').filter((segment) => segment.length > 0 && segment !== '.');
	if (segments.some((segment) => segment === '..')) {
		throw new PathTraversalError(`zip entry path escapes the archive root: "${rawName}"`);
	}
	if (segments.length === 0) {
		throw new PathTraversalError(`zip entry resolves to the archive root: "${rawName}"`);
	}
	return segments.join('/');
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp'
};

function guessMimeType(path: string): string {
	const dot = path.lastIndexOf('.');
	if (dot === -1) return 'application/octet-stream';
	const ext = path.slice(dot + 1).toLowerCase();
	return EXTENSION_MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** Applies `maxTextReadBytes` to a produced string (PDF/DOCX extracted text) the same
 * way `read` already applies it to a raw entry's bytes below: truncate at the byte
 * boundary, not the character boundary, and report `truncated` honestly. Extracted text
 * is not bounded by any of the archive-level caps - a small PDF can still extract to a
 * lot of text - so this cap is the only thing standing between it and an unbounded
 * `source_read` result. */
function truncateExtractedText(text: string, maxBytes: number): SourceReadResult {
	const buffer = Buffer.from(text, 'utf8');
	if (buffer.byteLength <= maxBytes) return { content: text, truncated: false };
	return { content: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

/** Byte order marks this reader honours. UTF-8's is checked first since its first byte
 * (0xEF) never collides with either UTF-16 mark's first byte (0xFF/0xFE), so the order
 * below cannot misdetect one for another. UTF-32's marks are not handled - nothing in
 * this codebase's supported exports produces UTF-32, and issue #311 only asks for these
 * three. */
function detectBom(
	bytes: Uint8Array
): { encoding: 'utf8' | 'utf16le' | 'utf16be'; length: number } | null {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return { encoding: 'utf8', length: 3 };
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
		return { encoding: 'utf16le', length: 2 };
	}
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
		return { encoding: 'utf16be', length: 2 };
	}
	return null;
}

/** Node has no native 'utf16be' encoding, so this swaps to LE and decodes that. Drops a
 * dangling trailing byte first - `Buffer.prototype.swap16` throws on an odd-length
 * buffer, and there is no partner byte left to swap it with anyway. See
 * `decodeEntryText` below for why dropping it, rather than doing anything else with it,
 * is the right call. */
function decodeUtf16be(bytes: Uint8Array): string {
	const evenLength = bytes.byteLength - (bytes.byteLength % 2);
	const swapped = Buffer.from(bytes.subarray(0, evenLength));
	swapped.swap16();
	return swapped.toString('utf16le');
}

/** Decodes a raw entry's bytes as text, honouring a UTF-8, UTF-16LE or UTF-16BE byte
 * order mark and falling back to UTF-8 with no BOM exactly as `read` did before this
 * function existed (issue #311). The BOM itself is never part of the returned content
 * in any of the three cases - a UTF-8 BOM used to survive as a leading U+FEFF
 * character, which was never a deliberate choice, just an unlooked-at one.
 *
 * `maxBytes`, when given, caps the *raw* byte length read, applied before decoding -
 * the same thing the plain-text branch of `read` already did for UTF-8 before this
 * function existed, not a cap on decoded characters. That is why a UTF-16 entry
 * truncates at roughly half the character count a UTF-8 entry of the same byte size
 * would: the cap is honest about what it bounds, bytes read rather than characters
 * produced. The `.htm`/`.html` branch of `read` below calls this with no cap at all -
 * it truncates the *stripped* string afterwards through `truncateExtractedText`, same
 * as it always has, so no byte cap applies inside this function for that path.
 *
 * The one case that needs care: a UTF-16 code unit is two bytes, so a byte cap that
 * lands on an odd offset within the post-BOM body leaves one dangling byte with no
 * partner to decode. That byte is dropped rather than decoded, never turned into a
 * replacement character - `readsAsText` (apps/web/src/lib/server/onboarding.ts, issue
 * #305) would otherwise read a spurious U+FFFD off the truncation boundary itself and
 * call an unlucky cut binary. For LE, `Buffer`'s own `toString('utf16le')` already
 * does this silently (verified directly against Node: it decodes `floor(length / 2)`
 * code units and never emits U+FFFD for a trailing odd byte). For BE, `decodeUtf16be`
 * above drops it explicitly before the byte swap. Either way `truncated` reflects only
 * whether the byte cap actually cut the entry, not whether the last code unit made it
 * through whole - honest about the former, silent (by one code unit, at most) about
 * the latter. */
function decodeEntryText(rawContent: Uint8Array, maxBytes?: number): SourceReadResult {
	const bom = detectBom(rawContent);
	const truncated = maxBytes !== undefined && rawContent.byteLength > maxBytes;
	const capped = truncated ? rawContent.subarray(0, maxBytes) : rawContent;
	const body = bom ? capped.subarray(Math.min(bom.length, capped.byteLength)) : capped;

	if (bom?.encoding === 'utf16le') {
		return { content: Buffer.from(body).toString('utf16le'), truncated };
	}
	if (bom?.encoding === 'utf16be') {
		return { content: decodeUtf16be(body), truncated };
	}
	return { content: Buffer.from(body).toString('utf8'), truncated };
}

/** Strips presentation noise a raw HTML export carries that no playbook rule reads:
 * a `<style>` block (CSS rules by class, never referenced by any extraction logic) and
 * the `style`, `class` and `lang` attributes repeated on nearly every run of text -
 * Microsoft Office's own HTML export (OneNote's `Publish`, exactly what `onenote.md`'s
 * own doc comment names as the source of this tree) writes `style='font-family:
 * "Calibri",sans-serif;font-size:11.0pt'` on every `<span>`, `<p class=MsoNormal>` on
 * every paragraph. SPEC.md §6.1 puts "unpack the export, walk it" on the deterministic
 * side of the envelope table, and this is the same kind of work: a rule, not a
 * decision, so it belongs here rather than asking the model to read past it on every
 * one of a notebook's pages. Every `<a href>`, `<img src>`, `<title>` and the tag
 * structure survive untouched - only presentation attributes and the `<style>` block
 * are removed, nothing that `onenote.md`'s parent/subpage/link/attachment rules read.
 * Scoped to `.htm`/`.html` entries only in `read()` below: no other playbook's
 * `source_read` path runs through this function, so it cannot corrupt a different
 * source's input.
 *
 * Measured on the 14-page Valdris demo corpus this issue's own script builds: 512,817
 * raw characters to 340,797 after this transformation, a 33.5% cut. That is real, and
 * lower than issue #261's own reported 512,817 to 309,478 (40%) - worth recording
 * rather than silently matching, since the difference is presentation noise this
 * function deliberately leaves in place (each element's other attributes, and the
 * blank line the removed `<style>` block leaves behind), not a bug in the
 * transformation described above.
 *
 * Worth one honest sentence for the next person tempted to re-derive this: a second
 * real job (a 3-page corpus, few links) showed cost per document is set by the import
 * loop's own step budget and full-transcript resend, not by how many bytes a document
 * reads (a 3-page and a 14-page corpus cost within 6% of each other per document) - so
 * this cut is real and worth keeping on its own merits, it just does not move the
 * credit estimate the way a bytes-in-context model would have predicted -
 * `onboarding.ts`'s `COLD_START_ESTIMATE.onenote` comment has the full account. */
export function stripHtmlPresentationNoise(html: string): string {
	return html
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/\s(?:style|class|lang)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * The real `SourceReader` implementation (issue #25). Fully in-memory by construction:
 * there is no real filesystem write anywhere in this class, so a path-traversal check
 * that somehow had a bug still cannot escape "a directory" because there is no directory
 * to escape - `read`/`list`/`readBinary` only ever resolve into this instance's own
 * `entries` map, built once at `open()` time from a validated entry list.
 */
export class ArchiveSourceReader implements SourceReader {
	/** SHA-256 of the raw archive bytes, for `import_job.artefact_sha256`. */
	readonly artefactSha256: string;
	private readonly entries = new Map<string, StoredEntry>();
	private readonly limits: ArchiveLimits;

	private constructor(limits: ArchiveLimits, artefactSha256: string) {
		this.limits = limits;
		this.artefactSha256 = artefactSha256;
	}

	/**
	 * What the upload action actually calls (issue #591). An export is not always an
	 * archive: OneNote hands a GM one file, the PDF guide says "any PDF file, uploaded
	 * directly", and the upload form's own `accept` offers `.pdf`, `.docx`, `.md` and
	 * `.txt`. Before this existed the only path was `open`, so a single non-zip file was
	 * refused with "archive failed to parse: invalid zip data" and a single file that
	 * happened to be OPC (a `.docx`, an `.xps`) was unpacked into its own plumbing and
	 * routed to `generic`: a one-page DOCX reached the estimate screen as eleven
	 * documents of `word/styles.xml` and friends, with a Start button under it.
	 *
	 * So the decision is made on the bytes, not the extension: `sniffUpload` says whether
	 * this is an archive to walk or one document to hand a playbook, and an OPC package
	 * counts as a document rather than an archive even though it parses as a zip. A
	 * single document becomes a one-entry reader keyed by the upload's own file name,
	 * which is what makes every downstream caller work unchanged - `detectSource` sees
	 * one `.pdf` and routes to `pdf`, exactly as it does for a zip containing one.
	 *
	 * `fileName` is somebody else's string, so it goes through the same
	 * `normalizeEntryPath` a zip entry does, and its directory part is dropped: a browser
	 * only ever sends a leaf name, and honouring one would put an upload's own name in
	 * charge of where it lands in the reader's namespace. A name that survives none of
	 * that falls back to `upload`, because refusing an upload over its file name would be
	 * a worse failure than reading it under a dull one.
	 */
	static openUpload(
		data: Uint8Array,
		fileName: string,
		limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
	): ArchiveSourceReader {
		if (data.byteLength > limits.maxArchiveBytes) {
			throw new ArchiveTooLargeError(
				`upload is ${data.byteLength} bytes, over the ${limits.maxArchiveBytes} byte limit`
			);
		}
		if (sniffUpload(data, { unzip: unzipSync }).format === 'zip') {
			return ArchiveSourceReader.open(data, limits);
		}

		const reader = new ArchiveSourceReader(limits, createHash('sha256').update(data).digest('hex'));
		const leaf = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
		let path: string;
		try {
			path = normalizeEntryPath(leaf);
		} catch {
			path = 'upload';
		}
		reader.entries.set(path, { path, content: data });
		return reader;
	}

	static open(
		data: Uint8Array,
		limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
	): ArchiveSourceReader {
		if (data.byteLength > limits.maxArchiveBytes) {
			throw new ArchiveTooLargeError(
				`archive is ${data.byteLength} bytes, over the ${limits.maxArchiveBytes} byte limit`
			);
		}

		const artefactSha256 = createHash('sha256').update(data).digest('hex');
		const reader = new ArchiveSourceReader(limits, artefactSha256);

		let entryCount = 0;
		let cumulativeUncompressed = 0;
		let unzipped: Record<string, Uint8Array>;
		try {
			unzipped = unzipSync(data, {
				filter(file: UnzipFileInfo): boolean {
					entryCount += 1;
					if (entryCount > limits.maxEntries) {
						throw new TooManyEntriesError(`archive has more than ${limits.maxEntries} entries`);
					}
					const isDirectory = file.name.endsWith('/');
					normalizeEntryPath(file.name);
					if (file.compression !== 0 && file.compression !== 8) {
						throw new UnsupportedCompressionError(
							`entry "${file.name}" uses unsupported compression method ${file.compression}`
						);
					}
					if (!isDirectory) {
						if (file.originalSize > limits.maxEntryUncompressedBytes) {
							throw new ZipBombError(
								`entry "${file.name}" declares ${file.originalSize} uncompressed bytes, over ` +
									`the ${limits.maxEntryUncompressedBytes} byte per-entry limit`
							);
						}
						// Cumulative check: unzipSync inflates everything it does not filter out in one
						// synchronous call, so many entries that each pass the per-entry cap can still
						// exhaust memory - this is what actually bounds total decompressed size.
						cumulativeUncompressed += file.originalSize;
						if (cumulativeUncompressed > limits.maxTotalUncompressedBytes) {
							throw new ZipBombError(
								`archive declares more than ${limits.maxTotalUncompressedBytes} total ` +
									'uncompressed bytes across its entries'
							);
						}
					}
					return !isDirectory;
				}
			});
		} catch (cause) {
			if (
				cause instanceof TooManyEntriesError ||
				cause instanceof PathTraversalError ||
				cause instanceof ZipBombError ||
				cause instanceof UnsupportedCompressionError
			) {
				throw cause;
			}
			throw new ArchiveParseError(
				`archive failed to parse: ${cause instanceof Error ? cause.message : String(cause)}`
			);
		}

		for (const [rawName, content] of Object.entries(unzipped)) {
			const path = normalizeEntryPath(rawName);
			reader.entries.set(path, { path, content });
		}
		return reader;
	}

	async list(path: string): Promise<SourceEntry[]> {
		const prefix = path === '' ? '' : `${path.replace(/\/+$/, '')}/`;
		const seen = new Map<string, SourceEntry>();
		for (const entry of this.entries.values()) {
			if (!entry.path.startsWith(prefix)) continue;
			const rest = entry.path.slice(prefix.length);
			if (rest === '') continue;
			const slash = rest.indexOf('/');
			if (slash === -1) {
				seen.set(entry.path, {
					path: entry.path,
					kind: 'file',
					sizeBytes: entry.content.byteLength
				});
			} else {
				const dirPath = prefix + rest.slice(0, slash);
				seen.set(dirPath, { path: dirPath, kind: 'directory' });
			}
		}
		return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	async read(path: string): Promise<SourceReadResult> {
		const entry = this.entries.get(path);
		if (!entry) throw new SourceNotFoundError(path);

		if (path.toLowerCase().endsWith('.pdf')) {
			let extraction: PdfTextExtraction;
			try {
				extraction = await extractPdfText(entry.content);
			} catch (cause) {
				throw new ArchiveEntryExtractionError(path, 'PDF', cause);
			}
			return truncateExtractedText(extraction.text, this.limits.maxTextReadBytes);
		}

		if (path.toLowerCase().endsWith('.docx')) {
			let extraction: DocxTextExtraction;
			try {
				extraction = await extractDocxText(entry.content);
			} catch (cause) {
				throw new ArchiveEntryExtractionError(path, 'DOCX', cause);
			}
			return truncateExtractedText(extraction.text, this.limits.maxTextReadBytes);
		}

		if (path.toLowerCase().endsWith('.htm') || path.toLowerCase().endsWith('.html')) {
			const stripped = stripHtmlPresentationNoise(decodeEntryText(entry.content).content);
			return truncateExtractedText(stripped, this.limits.maxTextReadBytes);
		}

		return decodeEntryText(entry.content, this.limits.maxTextReadBytes);
	}

	async readBinary(path: string): Promise<BinaryAsset> {
		const entry = this.entries.get(path);
		if (!entry) throw new SourceNotFoundError(path);
		return { mimeType: guessMimeType(path), base64: Buffer.from(entry.content).toString('base64') };
	}

	/** `SourceReader.sniffEntry` against this entry's own stored bytes, with the zip
	 * discrimination wired in so an OPC package inside an upload is named (`docx`, `xps`)
	 * rather than reported as a nested archive. Reads no more than `sniffUpload` does. */
	async sniffEntry(path: string): Promise<UploadSniff> {
		const entry = this.entries.get(path);
		if (!entry) throw new SourceNotFoundError(path);
		return sniffUpload(entry.content, { unzip: unzipSync });
	}

	/** Renders one page of a `.pdf` entry through `renderPdfPage` (issue #39), then checks
	 * the *rendered* page's pixel count and byte size against `maxRenderedPixels`/
	 * `maxRenderedBytes` before handing it back - `pdf.ts`'s own render-resolution
	 * constants already keep a normal page well inside these, but this boundary checks the
	 * actual output rather than trusting that. `pdf.ts`'s `openDocument` copies `bytes`
	 * before handing it to `pdfjs-dist` (which detaches whatever `Uint8Array` it is given),
	 * so passing `entry.content` here never invalidates it for a later `read`/`renderPage`
	 * call on the same entry. */
	async renderPage(path: string, page: number): Promise<RenderedPage> {
		const entry = this.entries.get(path);
		if (!entry) throw new SourceNotFoundError(path);
		if (!path.toLowerCase().endsWith('.pdf')) {
			throw new ArchiveEntryExtractionError(
				path,
				'PDF',
				new Error('page rendering is only supported for .pdf entries')
			);
		}

		let rendered: RenderedPage;
		try {
			rendered = await renderPdfPage(entry.content, page);
		} catch (cause) {
			throw new ArchiveEntryExtractionError(path, 'PDF', cause);
		}

		const pixelCount = rendered.width * rendered.height;
		if (pixelCount > this.limits.maxRenderedPixels) {
			throw new ImageDimensionsTooLargeError(
				path,
				rendered.width,
				rendered.height,
				this.limits.maxRenderedPixels
			);
		}
		const byteLength = Buffer.from(rendered.base64, 'base64').byteLength;
		if (byteLength > this.limits.maxRenderedBytes) {
			throw new ImageTooLargeError(path, byteLength, this.limits.maxRenderedBytes);
		}
		return rendered;
	}

	/** SHA-256 of one entry's raw bytes - the per-document content hash SPEC.md §6.4 uses
	 * to decide a re-import is a no-op (`entity_source_ref.content_hash`). Distinct from
	 * `artefactSha256`, which hashes the whole archive. */
	contentHashOf(path: string): string {
		const entry = this.entries.get(path);
		if (!entry) throw new SourceNotFoundError(path);
		return createHash('sha256').update(entry.content).digest('hex');
	}
}
