/**
 * The read-only half of the tool surface (SPEC.md §6.1, §6.3): `source_list`,
 * `source_read` and `page_image` reach the uploaded export through this interface, never
 * through Node's own `fs`. Unpacking the export, walking it and rendering a PDF page are
 * deterministic code, not the model's job - SPEC.md §6.1's envelope table puts "unpack
 * the export, walk it, render PDF pages, extract embedded images" on the deterministic
 * side of the line, and §6.5 relies on that: "file handling is deterministic code, so a
 * malicious archive meets a zip reader with limits, not a model with imagination."
 *
 * The real implementation shipped for issue #25: `ArchiveSourceReader` in `archive.ts`,
 * an actual zip/archive reader with size and path-traversal limits
 * (`DEFAULT_ARCHIVE_LIMITS`), and a real PDF page renderer. `apps/web/src/routes/
 * onboarding/import/+page.server.ts` opens it in three places: validating an upload,
 * detecting its playbook, and enumerating its documents. This module defines the seam
 * those call sites and the job runner share, plus an in-memory double for tests: a
 * job's `SourceReader` is scoped to exactly one unpacked export by construction, which
 * is also how SPEC.md §6.5's "every tool call is checked against the job's universe"
 * holds here - a document from a different job's export is simply not reachable through
 * this interface, there is no path that reaches it.
 */
import { unzipSync } from 'fflate';
import { sniffUpload, type UploadSniff } from './upload-format.js';

export interface SourceEntry {
	path: string;
	kind: 'file' | 'directory';
	sizeBytes?: number;
}

export interface SourceReadResult {
	content: string;
	/** True when the deterministic reader cut the content at its size cap (SPEC §6.5). */
	truncated: boolean;
}

export interface RenderedPage {
	mimeType: string;
	base64: string;
	width: number;
	height: number;
}

export interface BinaryAsset {
	mimeType: string;
	base64: string;
}

export interface SourceReader {
	list(path: string): Promise<SourceEntry[]>;
	read(path: string): Promise<SourceReadResult>;
	/** Reads a non-text file (an image found in the export) as base64, for `image_store`
	 * to hand to the image half of the seam without asking the model to shuttle bytes
	 * through its own context. */
	readBinary(path: string): Promise<BinaryAsset>;
	/** Renders one page of a PDF at `path` to an image (SPEC.md §6.3): "so a scanned page
	 * is simply looked at. Local and deterministic: no OCR provider, no per-page fee." */
	renderPage(path: string, page: number): Promise<RenderedPage>;
	/** What this entry actually is, decided from its own bytes rather than its name
	 * (`upload-format.ts`, issue #591). On the interface rather than only on
	 * `ArchiveSourceReader` because the callers that need it - detection, and the
	 * refusal that stops a job for a format nobody wrote a reader for - are the same
	 * two `detectSource`/`documentsForPlaybook` functions the in-memory double already
	 * stands in for. */
	sniffEntry(path: string): Promise<UploadSniff>;
	/** How many of the upload's files were OneNote Single File Web Page envelopes this
	 * reader expanded into page trees (issue #604). On the interface for the same reason
	 * `sniffEntry` is: detection needs it and cannot recover it from the entries, because
	 * an expanded envelope and a real exported page tree are the same shape afterwards. It
	 * decides whether the confirm screen says that the file does not record which scope
	 * the GM exported at, which is a thing OneNote's own `.mht` genuinely does not carry.
	 * Optional because the in-memory double has no upload behind it. */
	readonly oneNoteEnvelopes?: number;
	/** How many were OneNote's own binary `.one` sections or `.onepkg` notebooks this
	 * reader expanded into page trees (issue #603). Separate from the count above because
	 * the two say opposite things about scope, which is the only reason detection cares:
	 * an expanded `.mht` may be a whole notebook silently missing pages, while a `.onepkg`
	 * is a whole notebook missing none, measured in `docs/onenote-export.md`. So this one
	 * raises no scope notice, and that is the point of counting it apart. */
	readonly oneStoreNotebooks?: number;
}

export class SourceNotFoundError extends Error {
	constructor(path: string) {
		super(`source path not found in this job's export: "${path}"`);
		this.name = 'SourceNotFoundError';
	}
}

/**
 * In-memory test double, kept alongside the real `ArchiveSourceReader` (`archive.ts`)
 * because a fixture built from a flat map of path to text content is cheaper to write
 * than a real zip. `list` derives directories from the path prefixes present in the
 * map, so a fixture only has to declare its files.
 */
export class InMemorySourceReader implements SourceReader {
	private readonly files: ReadonlyMap<string, string>;
	private readonly binaries: ReadonlyMap<string, BinaryAsset>;
	private readonly pages: ReadonlyMap<string, RenderedPage>;
	readonly oneNoteEnvelopes: number;
	readonly oneStoreNotebooks: number;

	constructor(input: {
		files: Record<string, string>;
		binaries?: Record<string, BinaryAsset>;
		/** Keyed as `${path}#${page}`. */
		pages?: Record<string, RenderedPage>;
		/** Both default to zero, which is a real exported page tree: produced page by page,
		 * losing nothing, and needing no notice about its scope. Settable so a test can put
		 * detection in front of the two provenances that do differ without building a zip. */
		oneNoteEnvelopes?: number;
		oneStoreNotebooks?: number;
	}) {
		this.files = new Map(Object.entries(input.files));
		this.binaries = new Map(Object.entries(input.binaries ?? {}));
		this.pages = new Map(Object.entries(input.pages ?? {}));
		this.oneNoteEnvelopes = input.oneNoteEnvelopes ?? 0;
		this.oneStoreNotebooks = input.oneStoreNotebooks ?? 0;
	}

	async list(path: string): Promise<SourceEntry[]> {
		const prefix = path === '' ? '' : `${path.replace(/\/+$/, '')}/`;
		const seen = new Map<string, SourceEntry>();
		const record = (filePath: string, sizeBytes: number) => {
			if (!filePath.startsWith(prefix)) return;
			const rest = filePath.slice(prefix.length);
			const slash = rest.indexOf('/');
			if (slash === -1) {
				seen.set(filePath, { path: filePath, kind: 'file', sizeBytes });
			} else {
				const dirPath = prefix + rest.slice(0, slash);
				seen.set(dirPath, { path: dirPath, kind: 'directory' });
			}
		};
		for (const [filePath, content] of this.files) record(filePath, content.length);
		for (const [filePath, asset] of this.binaries) record(filePath, asset.base64.length);
		return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	async read(path: string): Promise<SourceReadResult> {
		const content = this.files.get(path);
		if (content === undefined) throw new SourceNotFoundError(path);
		return { content, truncated: false };
	}

	async readBinary(path: string): Promise<BinaryAsset> {
		const asset = this.binaries.get(path);
		if (!asset) throw new SourceNotFoundError(path);
		return asset;
	}

	async renderPage(path: string, page: number): Promise<RenderedPage> {
		const key = `${path}#${page}`;
		const rendered = this.pages.get(key);
		if (!rendered) throw new SourceNotFoundError(key);
		return rendered;
	}

	async sniffEntry(path: string): Promise<UploadSniff> {
		const text = this.files.get(path);
		if (text !== undefined) {
			return sniffUpload(new Uint8Array(Buffer.from(text, 'utf8')), { unzip: unzipSync });
		}
		const asset = this.binaries.get(path);
		if (asset) {
			return sniffUpload(new Uint8Array(Buffer.from(asset.base64, 'base64')), {
				unzip: unzipSync
			});
		}
		throw new SourceNotFoundError(path);
	}
}
