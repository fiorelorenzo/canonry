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

		const truncated = entry.content.byteLength > this.limits.maxTextReadBytes;
		const slice = truncated
			? entry.content.subarray(0, this.limits.maxTextReadBytes)
			: entry.content;
		return { content: Buffer.from(slice).toString('utf8'), truncated };
	}

	async readBinary(path: string): Promise<BinaryAsset> {
		const entry = this.entries.get(path);
		if (!entry) throw new SourceNotFoundError(path);
		return { mimeType: guessMimeType(path), base64: Buffer.from(entry.content).toString('base64') };
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
