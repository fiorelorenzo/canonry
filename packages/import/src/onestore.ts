/**
 * OneNote's own binary formats, read: a `.one` section and the `.onepkg` package that
 * holds a whole notebook (issue #603, epic #590, SPEC.md §6.1, §6.5, §6.6, §6.10).
 *
 * This reverses a deferral that had been on record since §6.10, and the reason it is a
 * reversal rather than a reconsideration is that both premises of the old one turned out
 * to be false. `docs/onenote-export.md` carries the measurement; the short version is
 * that `onenote_parser` 2.0.0 reads the desktop format ([MS-ONESTORE] §2.3) and not only
 * the OneDrive one (§2.8), and that it needs no sidecar process because it builds for
 * `wasm32-unknown-unknown`.
 *
 * ## Why this reader exists when three others already read a OneNote export
 *
 * Because it is the only one that recovers the hierarchy. Measured on the corpus, against
 * the same notebook exported every way OneNote offers:
 *
 * - The `.mht` reader (`mhtml.ts`) gets 70 pages, flat, with no section boundary and a
 *   byte-identical wrapper style on every one of them.
 * - This reader gets 88 pages across three named, ordered sections, with a `PageLevel` on
 *   every page: 21 top-level pages and 67 subpages grouped into page series.
 *
 * That is exactly the parent/subpage relation `onenote.md` already reads out of a folder
 * tree, and `onenote.md` calls it "the single strongest structural signal for a parent
 * relation this system reads from any source". Until this reader existed, the tree that
 * rule read had no parents in it.
 *
 * It is also the format a GM **already has on disk**, where every other path asks them to
 * open OneNote and choose an export first.
 *
 * ## Why the output is a folder tree and not a new playbook
 *
 * Same reasoning as `mhtml.ts`, and the same shape: `expandOneStore` emits exactly what
 * `expandOneNoteMhtml` emits, so there is no new playbook, no new `stepBudget` and no new
 * `estimate.ts` row. The one difference is the thing this issue is for: this tree has real
 * parents, so a subpage lands in a folder named after its parent page and the playbook's
 * rule finally has something true to read.
 *
 * The two readers agree deliberately, down to sharing `titleToSegment`, because a page
 * that arrived as one path from one reader and a different path from the other would be
 * two `entity_source_ref.path` values for one page, and SPEC.md §6.4's re-import matching
 * would resolve that by creating a duplicate. Nothing downstream can tell which reader
 * produced a tree except the reader's own `oneStoreNotebooks` count.
 *
 * ## What is deliberately not extracted
 *
 * - **Headings.** [MS-ONE] carries no style identifier saying a paragraph is a heading;
 *   the only available signals are font size and weight. `docs/corpus-onenote.md` already
 *   measured that guess going wrong on the `.mht`, where taking the 20pt `Calibri Light`
 *   paragraph as the page title found 63 of 70 pages. Inventing a heading level here would
 *   be the kind of confident guess SPEC.md §3's seventh guardrail is about.
 * - **Bold and italic.** `stripHtmlPresentationNoise` deletes the `style` attributes
 *   OneNote's HTML export carries them in, so the `.mht` path loses them too. Dropping
 *   them is parity, not a loss.
 * - **Note tags.** OneNote's own tag glyphs (`Contact`, `To Do`) are rendered by the HTML
 *   exporter as a 16x16 `<img>`, which is what the single `image/png` part in the corpus's
 *   `Note Storia.mht` actually is. They are metadata, not canvas content, and an `<img>`
 *   here would invite `image_store` to file a UI icon as a campaign asset.
 *
 * ## Untrusted content
 *
 * Same posture as `archive.ts` and `mhtml.ts`, with one addition that matters more here
 * than in either of them: this is roughly 8,000 lines of third-party binary-format parsing
 * over a file somebody else wrote. So it runs inside a wasm module with **no imports at
 * all** (verified: the artefact imports nothing, so it has no syscalls, no clock and no
 * network), and a fresh instance is created per file, which makes a trap in that parser
 * cost exactly the one document rather than the worker. Its own caps come from
 * `ArchiveLimits` rather than a new set of numbers, the same mapping `mhtml.ts` documents.
 */
import { brotliDecompressSync } from 'node:zlib';
import { titleToSegment, type ExpandedEntry } from './mhtml.js';
import { ONESTORE_WASM_BROTLI_BASE64 } from './onestore-wasm.generated.js';

export class OneStoreParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OneStoreParseError';
	}
}

export class OneStoreTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OneStoreTooLargeError';
	}
}

/** `onestore` is a `.one` section (or a `.onetoc2`), `onepkg` the cabinet of a notebook.
 * Taken from `sniffUpload`'s answer rather than sniffed again, so one place decides. */
export type OneStoreKind = 'onestore' | 'onepkg';

export interface OneStoreLimits {
	/** Cumulative cap on emitted entry bytes, `maxTotalUncompressedBytes` upstream. */
	maxTotalBytes: number;
	/** Cap on extracted attachment bytes, `maxEntryUncompressedBytes` upstream. */
	maxAttachmentBytes: number;
}

export interface ExpandOneStoreOptions {
	/** The upload's own file name. Load-bearing rather than cosmetic: for a `.one` the
	 * parser takes the section's display name from it, and for a `.onepkg` it is the only
	 * place a notebook name exists, since [MS-ONESTORE] does not record one. */
	fileName: string;
	kind: OneStoreKind;
	limits: OneStoreLimits;
}

interface WasmLink {
	target: string;
	start: number;
	end: number;
}

interface WasmAsset {
	name: string;
	off: number;
	len: number;
	alt: string;
}

type WasmBlock =
	| { k: 'p'; text: string; links: WasmLink[]; indent: number; list: 'bullet' | 'number' | null }
	| { k: 'table'; rows: WasmBlock[][][] }
	| { k: 'image'; asset: number }
	| { k: 'file'; asset: number }
	| { k: 'ink'; text: string };

interface WasmPage {
	title: string;
	level: number;
	id: string;
	created: number;
	updated: number;
	blocks: WasmBlock[];
	assets: WasmAsset[];
}

interface WasmSection {
	name: string;
	pages: WasmPage[];
}

type WasmResult =
	| {
			ok: true;
			sections: WasmSection[];
			blobBytes: number;
			attachmentsSeen: number;
			attachmentsDropped: number;
	  }
	| { ok: false; error: string };

/**
 * TypeScript ships the `WebAssembly` declarations in `lib.dom.d.ts` alone, and this
 * package compiles with `lib: ["ES2023"]` and `types: ["node"]` because it is server code:
 * adding `DOM` to reach one namespace would also make `document` and `window` typecheck
 * inside an import worker. So the three shapes this module actually touches are declared
 * here, module-scoped rather than global, and `declare` emits nothing, so at run time the
 * identifier still resolves to the real global.
 */
declare namespace WebAssembly {
	class Module {
		constructor(bytes: Uint8Array);
	}
	class Instance {
		readonly exports: Record<string, unknown>;
		constructor(module: Module, imports: Record<string, Record<string, unknown>>);
	}
}

interface WasmExports {
	memory: { readonly buffer: ArrayBuffer };
	onestore_alloc(len: number): number;
	onestore_alloc_name(len: number): number;
	onestore_parse(kind: number, blobBudget: number): number;
	onestore_free(pointer: number): void;
}

/**
 * Compiled once per process and reused, because compiling 795KB of wasm costs real
 * milliseconds and an import job parses one file per document. The module is stateless;
 * every parse gets its own instance, which is what keeps a trap contained.
 */
let compiled: WebAssembly.Module | undefined;

export interface ParsedOneStore {
	sections: WasmSection[];
	blobs: Buffer;
	attachmentsSeen: number;
	attachmentsDropped: number;
}

/**
 * One file through the parser. A parse failure is an `OneStoreParseError` carrying the
 * parser's own message, and so is a trap: `WebAssembly` surfaces one as a `RuntimeError`,
 * and since the instance is thrown away either way there is nothing to recover.
 */
export function parseOneStore(
	data: Uint8Array,
	options: Pick<ExpandOneStoreOptions, 'fileName' | 'kind' | 'limits'>
): ParsedOneStore {
	compiled ??= new WebAssembly.Module(
		brotliDecompressSync(Buffer.from(ONESTORE_WASM_BROTLI_BASE64, 'base64'))
	);
	const instance = new WebAssembly.Instance(compiled, {});
	const exports = instance.exports as unknown as WasmExports;

	let output: number | undefined;
	try {
		const name = Buffer.from(options.fileName, 'utf8');
		const namePointer = exports.onestore_alloc_name(name.byteLength);
		new Uint8Array(exports.memory.buffer, namePointer, name.byteLength).set(name);

		const inputPointer = exports.onestore_alloc(data.byteLength);
		new Uint8Array(exports.memory.buffer, inputPointer, data.byteLength).set(data);

		output = exports.onestore_parse(
			options.kind === 'onepkg' ? 1 : 0,
			options.limits.maxAttachmentBytes
		);

		// Read the header and the JSON before anything else touches memory: a `memory.grow`
		// detaches every existing view, so views are made per read and never cached.
		const jsonLength = new DataView(exports.memory.buffer).getUint32(output, true);
		const json = Buffer.from(exports.memory.buffer, output + 4, jsonLength).toString('utf8');
		const result = JSON.parse(json) as WasmResult;
		if (!result.ok) {
			throw new OneStoreParseError(`${options.kind} file could not be read: ${result.error}`);
		}
		// Copied out rather than referenced: the view dies with the instance.
		const blobs = Buffer.from(
			Buffer.from(exports.memory.buffer, output + 4 + jsonLength, result.blobBytes)
		);
		return {
			sections: result.sections,
			blobs,
			attachmentsSeen: result.attachmentsSeen,
			attachmentsDropped: result.attachmentsDropped
		};
	} catch (cause) {
		if (cause instanceof OneStoreParseError) throw cause;
		throw new OneStoreParseError(
			`${options.kind} file could not be read: ${cause instanceof Error ? cause.message : String(cause)}`
		);
	} finally {
		if (output !== undefined) {
			try {
				exports.onestore_free(output);
			} catch {
				// The instance is unreachable after this function returns, so a failed free
				// costs nothing. Swallowed rather than masking the real error above.
			}
		}
	}
}

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;'
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);
}

/**
 * A paragraph's text with its hyperlinks turned into `<a>` elements.
 *
 * Offsets arrive as UTF-16 code units, which is what a JavaScript string index already is,
 * so they slice directly. They are applied back to front so an earlier link's replacement
 * cannot move a later one's offsets, and overlapping links are dropped rather than nested,
 * because an `<a>` inside an `<a>` is not valid HTML and OneNote does not produce one.
 */
function paragraphHtml(text: string, links: readonly WasmLink[]): string {
	if (links.length === 0) return escapeHtml(text);

	const ordered = [...links].sort((a, b) => a.start - b.start);
	const kept: WasmLink[] = [];
	let reach = 0;
	for (const link of ordered) {
		if (link.start < reach || link.end > text.length) continue;
		kept.push(link);
		reach = link.end;
	}

	let out = '';
	let cursor = 0;
	for (const link of kept) {
		out += escapeHtml(text.slice(cursor, link.start));
		const anchor = escapeHtml(text.slice(link.start, link.end));
		out += `<a href="${escapeHtml(link.target)}">${anchor}</a>`;
		cursor = link.end;
	}
	return out + escapeHtml(text.slice(cursor));
}

/** The blocks of one page (or one table cell) as HTML.
 *
 * Consecutive list items become one `<ul>`/`<ol>` run, nested on their outline depth, so
 * an indented list survives as a nested list rather than as a `style` attribute
 * `stripHtmlPresentationNoise` would delete. A non-list paragraph's indent is dropped on
 * purpose: `docs/corpus-onenote.md` measured that indentation inside a page tracks where
 * the GM put a note container on the canvas, not any hierarchy. */
function blocksHtml(blocks: readonly WasmBlock[], attachmentFolder: string): string {
	const out: string[] = [];
	let openLists: Array<'ul' | 'ol'> = [];

	const closeTo = (depth: number) => {
		while (openLists.length > depth) out.push(`</${openLists.pop()}>`);
	};

	for (const block of blocks) {
		if (block.k === 'p' && block.list !== null) {
			const tag = block.list === 'number' ? 'ol' : 'ul';
			const depth = Math.min(block.indent, 8) + 1;
			closeTo(depth);
			while (openLists.length < depth) {
				out.push(`<${tag}>`);
				openLists.push(tag);
			}
			out.push(`<li>${paragraphHtml(block.text, block.links)}</li>`);
			continue;
		}

		closeTo(0);
		switch (block.k) {
			case 'p':
				out.push(`<p>${paragraphHtml(block.text, block.links)}</p>`);
				break;
			case 'ink':
				out.push(`<p>${escapeHtml(block.text)}</p>`);
				break;
			case 'table': {
				const rows = block.rows
					.map((row) => {
						const cells = row
							.map((cell) => `<td>${blocksHtml(cell, attachmentFolder)}</td>`)
							.join('');
						return `<tr>${cells}</tr>`;
					})
					.join('\n');
				out.push(`<table>\n${rows}\n</table>`);
				break;
			}
			case 'image':
			case 'file':
				// Resolved by the caller, which is the only place that knows the asset table.
				out.push(`\u0000${block.k}:${block.asset}\u0000`);
				break;
		}
	}
	closeTo(0);
	return out.join('\n');
}

/** OneNote's own two metas, which is what `isOneNoteHtml` and therefore `detectSource`
 * key on. Written here rather than passed through from the file because the binary format
 * has no HTML head to pass through, and a tree from this reader has to be recognised as
 * OneNote's exactly as an expanded `.mht` is. */
const HEAD =
	'<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n' +
	'<meta name="ProgId" content="OneNote.File">\n' +
	'<meta name="Generator" content="Microsoft OneNote">';

/** Allocates one path per page, keeping duplicate titles apart within their own folder.
 *
 * Two pages in one section really can share a title: the corpus has two called
 * "X Continente Orientale" and two called "X Lunga Terra" in `Mondo`, so the numeric
 * suffix is not a defensive flourish. It is scoped per folder rather than per section,
 * because two subpages of different parents sharing a title are not a collision. */
class Names {
	private readonly used = new Map<string, number>();

	take(directory: string, base: string): string {
		const key = `${directory}\u0000${base}`;
		const seen = this.used.get(key) ?? 0;
		this.used.set(key, seen + 1);
		return seen === 0 ? base : `${base} (${seen + 1})`;
	}
}

/**
 * One `.one` or `.onepkg` into the folder tree `onenote.md` reads.
 *
 * A `.onepkg` becomes `<notebook>/<section>/<page>.htm`, with a subpage in a folder named
 * after its parent page and an attachment in a sibling `<page>_files/`. A `.one` has no
 * notebook in it, only one section, so it becomes `<section>/<page>.htm`: wrapping it in
 * an invented notebook folder would add a level the file does not have, and the playbook's
 * parent rule reads the containing folder either way.
 *
 * `PageLevel` is what builds the nesting. Level 1 is a top-level page, level 2 a subpage
 * of the nearest preceding level-1 page, and so on, which is OneNote's own model and how
 * its navigation pane draws the same tree. A page whose level skips ahead of anything seen
 * so far is attached to the deepest page there is rather than dropped.
 */
export function expandOneStore(
	data: Uint8Array,
	options: ExpandOneStoreOptions
): ExpandedEntry[] {
	const parsed = parseOneStore(data, options);

	const stem = options.fileName
		.replace(/\\/g, '/')
		.split('/')
		.pop()!
		.replace(/\.(one|onetoc2|onepkg)$/i, '');

	const names = new Names();
	const root = options.kind === 'onepkg' ? titleToSegment(stem) || 'notebook' : '';

	const entries: ExpandedEntry[] = [];
	let cumulative = 0;
	const push = (path: string, bytes: Uint8Array) => {
		cumulative += bytes.byteLength;
		if (cumulative > options.limits.maxTotalBytes) {
			throw new OneStoreTooLargeError(
				`expanding this ${options.kind} file produces more than ${options.limits.maxTotalBytes} bytes`
			);
		}
		entries.push({ path, bytes });
	};

	/** Where a page's own `.htm` lives, keyed by the `onenote:` link id and by title, so an
	 * in-body link between two pages of this export can be rewritten to a real path the way
	 * `expandOneNoteMhtml` rewrites one. */
	const pathById = new Map<string, string>();
	const pathByTitle = new Map<string, string>();

	interface Planned {
		page: WasmPage;
		path: string;
		folder: string;
		name: string;
	}
	const planned: Planned[] = [];

	for (const [index, section] of parsed.sections.entries()) {
		const sectionSegment = names.take(
			root,
			titleToSegment(section.name) || `Section ${index + 1}`
		);
		const sectionDirectory = root === '' ? sectionSegment : `${root}/${sectionSegment}`;

		// `childDirectory[n]` is where a page of level `n + 1` goes. Index 0 is the section
		// itself, and each page overwrites the slot for its own children.
		const childDirectory: string[] = [sectionDirectory];

		for (const [pageIndex, page] of section.pages.entries()) {
			const level = Math.max(1, Math.min(page.level, childDirectory.length));
			const directory = childDirectory[level - 1] ?? sectionDirectory;
			const base = titleToSegment(page.title) || `Untitled page ${pageIndex + 1}`;
			const name = names.take(directory, base);
			const path = `${directory}/${name}.htm`;

			childDirectory.length = level;
			childDirectory.push(`${directory}/${name}`);

			planned.push({ page, path, folder: `${directory}/${name}_files`, name });
			if (page.id !== '' && !pathById.has(page.id)) pathById.set(page.id, path);
			if (page.title !== '' && !pathByTitle.has(page.title)) pathByTitle.set(page.title, path);
		}
	}

	for (const { page, path, folder, name } of planned) {
		let body = blocksHtml(page.blocks, folder);

		// Assets first, so the placeholders left by `blocksHtml` become real paths and every
		// emitted copy counts against the cumulative cap.
		body = body.replace(/\u0000(image|file):(\d+)\u0000/g, (_whole, kind: string, raw: string) => {
			const asset = page.assets[Number(raw)];
			if (asset === undefined) return '';
			const target = `${name}_files/${asset.name}`;
			if (kind === 'image') {
				return `<img src="${escapeHtml(target)}" alt="${escapeHtml(asset.alt)}">`;
			}
			return `<p><a href="${escapeHtml(target)}">${escapeHtml(asset.name)}</a></p>`;
		});

		for (const asset of page.assets) {
			push(`${folder}/${asset.name}`, parsed.blobs.subarray(asset.off, asset.off + asset.len));
		}

		// `onenote:#<title>&section-id=...&page-id={...}` is how OneNote writes a link
		// between two pages, and `docs/corpus-onenote.md` measured that those survive an
		// export. Rewritten to the target's own entry path when the target is in this
		// upload, so `onenote.md`'s link rule sees a relation it can ground, and left alone
		// otherwise, because a link out of the export is not a relation we can resolve.
		body = body.replace(
			/href="onenote:#([^"]*)"/gi,
			(whole, encoded: string) => {
				const raw = encoded.replace(/&amp;/gi, '&');
				const pageId = /[?&]page-id=(\{[^&}]*\})/i.exec(raw)?.[1];
				const byId = pageId === undefined ? undefined : pathById.get(pageId);
				// Both lookups earn their place, measured on the corpus: inside a `.onepkg`
				// the `page-id` GUID matches a page's own `link_target_id`, because the
				// package carries the `.onetoc2` that resolves it, while in a bare `.one`
				// section it never does and the title is the only thing that works.
				const encodedTitle = raw.split('&')[0] ?? '';
				let title = encodedTitle;
				try {
					title = decodeURIComponent(encodedTitle);
				} catch {
					// A stray `%` in a page title is not an encoding, so the raw form is right.
				}
				const target = byId ?? pathByTitle.get(title) ?? pathByTitle.get(encodedTitle);
				return target === undefined ? whole : `href="${escapeHtml(target)}"`;
			}
		);

		const title = escapeHtml(page.title || name);
		const document =
			`<html>\n<head>\n${HEAD}\n<title>${title}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
		push(path, new Uint8Array(Buffer.from(document, 'utf8')));
	}

	return entries;
}
