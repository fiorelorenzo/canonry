/**
 * OneNote's own "Single File Web Page" export, read (issue #592, epic #590, SPEC.md §6.1,
 * §6.5, §6.6). One MIME envelope of quoted-printable HTML written by OneNote itself, with
 * no third-party tool anywhere in the story: the `onenote` playbook's documented input is
 * a folder tree produced by `meichthys/onenote-html-export`, which the GM has to find,
 * install and run on Windows first, and this is the same page HTML straight out of the
 * product.
 *
 * ## What the format actually carries, measured rather than assumed
 *
 * Read off the four real `.mht` files in the corpus (`docs/corpus-onenote.md`), at all
 * three scopes OneNote exports at:
 *
 * - **The envelope is either single-part or `multipart/related`,** and which one you get is
 *   not the scope: three of the four are a single `text/html` part with
 *   `Content-Transfer-Encoding: quoted-printable`, and the one section export that has an
 *   embedded image is `multipart/related` with the HTML, a `image/png` part in base64, and
 *   a `filelist.xml`. So both shapes have to work and neither can be assumed from the
 *   file's size or scope.
 * - **Pages are recoverable and they are flat.** Every page is one
 *   `<div style='direction:ltr;border-width:100%'>`, and every one of those sits at the top
 *   of `<body>` with no nesting: 1 in the page export, 23 and 52 in the two section
 *   exports, 70 in the notebook one, all at depth zero. A page's title is the first `<p>`
 *   inside its wrapper, followed by a date paragraph and a time paragraph.
 * - **The hierarchy is gone, and that is the finding that shapes this reader.** The
 *   notebook export is its sections' pages concatenated with *nothing between them*: no
 *   section name, no boundary, no nesting attribute, and the wrapper `div`'s style byte
 *   identical on all 70 pages. The varying `margin-left` values inside a page track where
 *   the GM put a note container on the page canvas, not the page's level in the notebook.
 *   So this reader produces a **flat** tree on purpose. Inventing a hierarchy out of
 *   indentation would be exactly the kind of confident guess SPEC.md §3's seventh guardrail
 *   is about, and `onenote.md`'s parent/subpage rule reads the folder tree, so a flat tree
 *   gives it nothing to misread rather than something wrong to read.
 * - **Internal page links survive**, as `href="onenote:#<page title>&section-id={...}&page-id={...}"`.
 *   The title in that fragment is what `onenote.md`'s link rule can use, so it is rewritten
 *   to the target page's own entry path when that page is in the same export and left alone
 *   when it is not.
 *
 * ## Why the output is a folder tree rather than a new playbook
 *
 * `expandOneNoteMhtml` turns one `.mht` into exactly the shape `onenote.md` already
 * describes: one `.htm` per page, each embedded resource in a sibling `<page>_files/`
 * folder. So there is no new playbook, no new `stepBudget` and no new `estimate.ts` row -
 * the reader ends where the existing prompt begins, which is also why the parent/subpage
 * rule cannot regress: it is the same rule reading the same kind of input, over a tree that
 * happens to have no parents in it.
 *
 * ## Untrusted content, and what maps from `archive.ts`
 *
 * Same posture as `archive.ts`, and its header comment is worth reading first, but the
 * three defences do not map one for one and pretending they do would be worse than saying
 * where the difference is:
 *
 * - **Part count** maps directly, and is checked as the envelope is walked rather than
 *   after, so a million-part file stops at the cap instead of being split first.
 * - **Path traversal** maps directly and is real: a part's `Content-Location` is a URL
 *   somebody else wrote, and `file:///C:/x/../../../etc/passwd` is one line of attack. Every
 *   location goes through the same rejection `archive.ts` applies to a zip entry name, and
 *   a page title becomes a path only after the same treatment.
 * - **The declared-size cap does not map, because MIME declares no sizes.** What replaces
 *   it is that neither transfer encoding can expand: base64 decodes to three quarters of
 *   its input and quoted-printable decodes to no more than its input, so a part cannot
 *   inflate the way a zip entry can. The caps here therefore bound *decoded* bytes per part
 *   and cumulatively across parts, checked as each part is decoded, which is the honest
 *   version of the same guarantee rather than a check on a number the format does not have.
 *   Expansion into pages is bounded the same way: a resource referenced by several pages is
 *   emitted beside each of them and every copy counts against the cumulative cap.
 *
 * A part that lies about itself is therefore a part whose `Content-Type` does not match its
 * bytes, and nothing here trusts that header for anything but choosing a decoder: a
 * resource is stored and handed on as bytes, and `media-store.ts`'s own limits are what
 * decide whether an image is an image.
 */
export class MhtmlParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MhtmlParseError';
	}
}

export class MhtmlTooManyPartsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MhtmlTooManyPartsError';
	}
}

export class MhtmlPartTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MhtmlPartTooLargeError';
	}
}

export class MhtmlLocationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MhtmlLocationError';
	}
}

export interface MhtmlLimits {
	/** Parts in the envelope, checked as it is walked. */
	maxParts: number;
	/** Decoded bytes of any one part. */
	maxPartBytes: number;
	/** Decoded bytes across every part, and across every page and resource copy the
	 * expansion produces. */
	maxTotalBytes: number;
}

export interface MhtmlPart {
	/** Lowercased media type with no parameters. */
	contentType: string;
	/** Raw `Content-Location`, kept for the record. */
	location: string;
	/** The relative path the main document references this part by: the tail of
	 * `Content-Location` after the directory the main document itself sits in. */
	path: string;
	bytes: Uint8Array;
}

export interface ParsedMhtml {
	/** The `text/html` part the envelope is about. */
	main: MhtmlPart;
	/** Everything else, keyed by the relative path the HTML refers to it by. */
	resources: MhtmlPart[];
}

const HEADER_BLOCK = /\r?\n\r?\n/;

/** One header block into a lowercased map. Continuation lines (RFC 5322 folding) are
 * joined onto the header they continue, which OneNote does not use but a `.mht` written by
 * something else might. */
function parseHeaders(block: string): Map<string, string> {
	const headers = new Map<string, string>();
	let name = '';
	for (const rawLine of block.split(/\r?\n/)) {
		if (rawLine.length === 0) continue;
		if (/^[ \t]/.test(rawLine) && name !== '') {
			headers.set(name, `${headers.get(name) ?? ''} ${rawLine.trim()}`);
			continue;
		}
		const colon = rawLine.indexOf(':');
		if (colon === -1) continue;
		name = rawLine.slice(0, colon).trim().toLowerCase();
		headers.set(name, rawLine.slice(colon + 1).trim());
	}
	return headers;
}

/**
 * Decodes quoted-printable. Soft line breaks (`=` at end of line) join the two lines, and
 * `=XX` is one byte. A trailing `=` with nothing after it, and a `=` followed by anything
 * that is not two hex digits, are both left as the literal bytes they are rather than
 * treated as an error: this is somebody else's file, and a malformed escape in the middle
 * of a notebook should cost that escape and not the import.
 */
function decodeQuotedPrintable(text: string): Uint8Array {
	const out = Buffer.alloc(text.length);
	let at = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] !== '=') {
			out[at++] = text.charCodeAt(i) & 0xff;
			continue;
		}
		// A soft line break is `=` then the line ending, and both endings occur: the real
		// exports are CRLF, and a fixture written on this box is LF. The two characters are
		// looked at one at a time rather than as a two-character slice, because at the end of
		// a line the slice also picks up the first character of the next line.
		if (text[i + 1] === '\n') {
			i += 1;
			continue;
		}
		if (text[i + 1] === '\r' && text[i + 2] === '\n') {
			i += 2;
			continue;
		}
		const escape = text.slice(i + 1, i + 3);
		if (/^[0-9a-fA-F]{2}$/.test(escape)) {
			out[at++] = Number.parseInt(escape, 16);
			i += 2;
			continue;
		}
		out[at++] = 0x3d;
	}
	return new Uint8Array(out.subarray(0, at));
}

function decodeBody(body: string, encoding: string): Uint8Array {
	const normalized = encoding.trim().toLowerCase();
	if (normalized === 'quoted-printable') return decodeQuotedPrintable(body);
	if (normalized === 'base64') {
		return new Uint8Array(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'));
	}
	// 7bit, 8bit, binary, or absent: the bytes are the bytes. `body` came out of a latin1
	// decode of the original buffer, so this puts them back unchanged.
	return new Uint8Array(Buffer.from(body, 'latin1'));
}

/**
 * Rejects a `Content-Location` that escapes the document's own directory, and returns the
 * path the main document would reference it by. Deliberately the same posture as
 * `archive.ts`'s `normalizeEntryPath`: any traversal segment is a hard rejection, never
 * something to resolve down to a safe path.
 *
 * `mainDirectory` is the directory part of the main document's own location (OneNote writes
 * `file:///C:/4F0944EF/`), so a resource at `file:///C:/4F0944EF/Mondo_file/image001.png`
 * comes back as `Mondo_file/image001.png`, which is exactly the string the HTML's `src`
 * carries. A location outside that directory keeps its full path, minus the scheme and
 * host, because there is nothing to make it relative to.
 */
export function relativeLocation(location: string, mainDirectory: string): string {
	const withoutScheme = location
		.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
		.replace(/^\/+/, '')
		.replace(/\\/g, '/');
	if (withoutScheme.includes('\0')) {
		throw new MhtmlLocationError(`part location contains a NUL byte: ${JSON.stringify(location)}`);
	}
	const segments = withoutScheme.split('/').filter((s) => s.length > 0 && s !== '.');
	if (segments.some((s) => s === '..')) {
		throw new MhtmlLocationError(`part location escapes the document: "${location}"`);
	}
	const joined = segments.join('/');
	return mainDirectory !== '' && joined.startsWith(`${mainDirectory}/`)
		? joined.slice(mainDirectory.length + 1)
		: joined;
}

/** The directory part of the main document's own location, in the same normalised form
 * `relativeLocation` produces, so resource paths can be made relative to it. */
function mainDirectoryOf(location: string): string {
	const normalised = location
		.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
		.replace(/^\/+/, '')
		.replace(/\\/g, '/');
	const slash = normalised.lastIndexOf('/');
	return slash === -1 ? '' : normalised.slice(0, slash);
}

/**
 * Splits a MIME envelope into its main HTML part and its resources. Single-part and
 * `multipart/related` both go through here, because a single-part envelope is just the
 * degenerate case: one part, no boundary, no resources.
 */
export function parseMhtml(data: Uint8Array, limits: MhtmlLimits): ParsedMhtml {
	if (data.byteLength > limits.maxTotalBytes) {
		throw new MhtmlPartTooLargeError(
			`mhtml file is ${data.byteLength} bytes, over the ${limits.maxTotalBytes} byte limit`
		);
	}
	// latin1 keeps one character per byte, so every offset below is a byte offset and the
	// decoders above can put the bytes back exactly. Decoding as UTF-8 here would corrupt
	// the base64 and quoted-printable bodies before they were ever decoded.
	const text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('latin1');

	const split = HEADER_BLOCK.exec(text);
	if (!split) throw new MhtmlParseError('mhtml file has no header block');
	const envelope = parseHeaders(text.slice(0, split.index));
	const body = text.slice(split.index + split[0].length);

	const contentType = envelope.get('content-type') ?? '';
	const boundaryMatch = /boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(contentType);
	const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? null;

	const rawParts: string[] = [];
	if (boundary === null) {
		// Single-part: the envelope's own headers describe the one part, so the whole file is
		// the part and re-parsing its headers below costs one small regex.
		rawParts.push(text);
	} else {
		const delimiter = `--${boundary}`;
		let at = body.indexOf(delimiter);
		if (at === -1) {
			throw new MhtmlParseError(`multipart mhtml declares boundary "${boundary}" and has none`);
		}
		// Walked with `indexOf` rather than `split`, so the part cap is checked as parts are
		// found: a file that declares a million of them stops at the cap instead of
		// allocating a million strings first.
		while (at !== -1) {
			const from = at + delimiter.length;
			if (body.startsWith('--', from)) break;
			const next = body.indexOf(delimiter, from);
			rawParts.push(
				(next === -1 ? body.slice(from) : body.slice(from, next)).replace(/^\r?\n/, '')
			);
			if (rawParts.length > limits.maxParts) {
				throw new MhtmlTooManyPartsError(`mhtml file has more than ${limits.maxParts} parts`);
			}
			at = next;
		}
	}

	let cumulative = 0;
	const parsed: { headers: Map<string, string>; bytes: Uint8Array }[] = [];
	for (const raw of rawParts) {
		const partSplit = HEADER_BLOCK.exec(raw);
		if (!partSplit) continue;
		const headers = parseHeaders(raw.slice(0, partSplit.index));
		const bytes = decodeBody(
			raw.slice(partSplit.index + partSplit[0].length),
			headers.get('content-transfer-encoding') ?? ''
		);
		if (bytes.byteLength > limits.maxPartBytes) {
			throw new MhtmlPartTooLargeError(
				`mhtml part "${headers.get('content-location') ?? '(unnamed)'}" decodes to ` +
					`${bytes.byteLength} bytes, over the ${limits.maxPartBytes} byte per-part limit`
			);
		}
		cumulative += bytes.byteLength;
		if (cumulative > limits.maxTotalBytes) {
			throw new MhtmlPartTooLargeError(
				`mhtml parts decode to more than ${limits.maxTotalBytes} total bytes`
			);
		}
		parsed.push({ headers, bytes });
	}

	const mainIndex = parsed.findIndex((p) =>
		(p.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')
	);
	if (mainIndex === -1) throw new MhtmlParseError('mhtml file carries no text/html part');

	const mainHeaders = parsed[mainIndex]!.headers;
	const mainLocation = mainHeaders.get('content-location') ?? '';
	const directory = mainDirectoryOf(mainLocation);
	const toPart = (entry: { headers: Map<string, string>; bytes: Uint8Array }): MhtmlPart => {
		const location = entry.headers.get('content-location') ?? '';
		return {
			contentType: (entry.headers.get('content-type') ?? 'application/octet-stream')
				.split(';')[0]!
				.trim()
				.toLowerCase(),
			location,
			path: relativeLocation(location, directory),
			bytes: entry.bytes
		};
	};

	return {
		main: toPart(parsed[mainIndex]!),
		resources: parsed.filter((_, i) => i !== mainIndex).map(toPart)
	};
}

/** OneNote's own signature inside the page HTML. Checked on the decoded document rather
 * than on the envelope, because the envelope headers say nothing about which program wrote
 * it. Both metas, because `Generator` alone also appears on Word's HTML export. */
export function isOneNoteHtml(html: string): boolean {
	return /content=3?D?"?OneNote\.File/i.test(html) && /Microsoft OneNote/i.test(html);
}

export interface OneNotePage {
	/** The page's own title, as OneNote wrote it in the first paragraph of the page. */
	title: string;
	/** The page's wrapper `div` and everything in it, verbatim. */
	html: string;
}

/**
 * One entry per page, in export order. The split rule is the wrapper `div` OneNote opens
 * each page with, taken only at depth zero inside `<body>`: measured across all four real
 * files, every page wrapper is a top-level sibling and none is nested, so depth is what
 * distinguishes a page from a note container that happens to carry the same style.
 *
 * The title is the first `<p>` inside the wrapper, and not the 20pt `Calibri Light`
 * paragraph a first look suggests: 7 of the notebook export's 70 pages have a title in
 * some other size, and keying on the size found 63 of them. One page in that file has a
 * genuinely empty title, which comes back as an empty string for the caller to name.
 */
export function splitOneNotePages(html: string): OneNotePage[] {
	const bodyAt = html.search(/<body\b/i);
	if (bodyAt === -1) return [];
	const body = html.slice(bodyAt);

	const starts: number[] = [];
	let depth = 0;
	for (const match of body.matchAll(/<div\b[^>]*>|<\/div\s*>/gi)) {
		if (match[0].startsWith('</')) {
			depth -= 1;
			continue;
		}
		if (depth === 0 && /border-width:\s*100%/i.test(match[0])) starts.push(match.index);
		depth += 1;
	}
	if (starts.length === 0) return [];

	const pages: OneNotePage[] = [];
	for (let i = 0; i < starts.length; i += 1) {
		const end = i + 1 < starts.length ? starts[i + 1]! : body.search(/<\/body\s*>/i);
		const segment = body.slice(starts[i]!, end === -1 ? body.length : end);
		const firstParagraph = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(segment);
		pages.push({ title: plainText(firstParagraph?.[1] ?? ''), html: segment });
	}
	return pages;
}

const ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	'#39': "'"
};

/** Tags out, the handful of entities OneNote's export actually writes resolved, whitespace
 * collapsed. Only ever used on a title, so it does not need to be a general HTML decoder
 * and deliberately is not one. */
function plainText(fragment: string): string {
	return fragment
		.replace(/<[^>]*>/g, '')
		.replace(/&(#?[a-z0-9]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
		.replace(/\s+/g, ' ')
		.trim();
}

/** A page title turned into one path segment. Everything a filesystem or a path check
 * would object to goes, because this string becomes an entry path a `source_read` resolves
 * and an `entity_source_ref.path` a re-import matches on. Length is capped so a page whose
 * title is a paragraph does not produce a path nothing can handle.
 *
 * Exported because `onestore.ts` builds the same tree from the binary format (issue #603)
 * and the two have to agree character for character: a page that arrives as
 * `Foo Bar.htm` from one reader and `Foo  Bar.htm` from the other would be two different
 * `entity_source_ref.path` values for one page, which SPEC.md §6.4's re-import matching
 * resolves by creating a duplicate. */
export function titleToSegment(title: string): string {
	const cleaned = title
		.replace(/[\0-\x1f\x7f]/g, '')
		.replace(/[/\\:*?"<>|]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[. ]+|[. ]+$/g, '')
		.trim();
	return cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
}

export interface ExpandedEntry {
	path: string;
	bytes: Uint8Array;
}

export interface ExpandOneNoteMhtmlOptions {
	/** Used as the top-level folder, so the tree a playbook walks is named after what the
	 * GM uploaded rather than after the temporary directory OneNote happened to use. */
	notebookName: string;
	limits: MhtmlLimits;
}

/**
 * One `.mht` into the folder tree `onenote.md` reads: `<notebook>/<page>.htm` per page,
 * plus `<notebook>/<page>_files/<resource>` for each resource that page's HTML references.
 *
 * Four decisions worth stating, because each of them is a place a reader could have been
 * cleverer and wronger:
 *
 * - **The tree is flat.** See this module's header: the export carries no hierarchy, so
 *   nothing here invents one.
 * - **Duplicate titles are real** and get a numeric suffix in export order. The corpus has
 *   two pages called "X Continente Orientale" and two called "X Lunga Terra" in one
 *   section, so this is not a defensive flourish. Export order is stable for the same
 *   notebook, and a page that moves gets matched semantically instead (SPEC.md §6.4).
 * - **A resource referenced by several pages is emitted beside each of them,** because
 *   `onenote.md`'s attachment rule is about a folder named after *its* page, and a shared
 *   copy would be beside one page and a lie about the others. Every copy counts against
 *   the cumulative byte cap.
 * - **A resource nothing references is dropped**, which in practice is `filelist.xml`: it
 *   is OneNote's own manifest of the parts we have already parsed, and enumerating it would
 *   cost a document to propose nothing.
 */
export function expandOneNoteMhtml(
	data: Uint8Array,
	options: ExpandOneNoteMhtmlOptions
): ExpandedEntry[] {
	const { main, resources } = parseMhtml(data, options.limits);
	const html = Buffer.from(main.bytes).toString('utf8');
	const pages = splitOneNotePages(html);
	if (pages.length === 0) {
		throw new MhtmlParseError('mhtml file carries no OneNote page wrappers');
	}

	const root = titleToSegment(options.notebookName.replace(/\.mht(ml)?$/i, '')) || 'notebook';
	const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1] ?? '';
	const bodyOpen = /<body\b[^>]*>/i.exec(html)?.[0] ?? '<body>';

	const used = new Map<string, number>();
	const named = pages.map((page, index) => {
		const base = titleToSegment(page.title) || `Untitled page ${index + 1}`;
		const seen = used.get(base) ?? 0;
		used.set(base, seen + 1);
		return { ...page, name: seen === 0 ? base : `${base} (${seen + 1})` };
	});

	/** Where a page's own `.htm` lives, so a link between two pages can be rewritten. */
	const pathByTitle = new Map<string, string>();
	for (const page of named) {
		if (page.title !== '' && !pathByTitle.has(page.title)) {
			pathByTitle.set(page.title, `${root}/${page.name}.htm`);
		}
	}

	const entries: ExpandedEntry[] = [];
	let cumulative = 0;
	const push = (path: string, bytes: Uint8Array) => {
		cumulative += bytes.byteLength;
		if (cumulative > options.limits.maxTotalBytes) {
			throw new MhtmlPartTooLargeError(
				`expanding this mhtml file produces more than ${options.limits.maxTotalBytes} bytes`
			);
		}
		entries.push({ path, bytes });
	};

	for (const page of named) {
		const attachmentFolder = `${root}/${page.name}_files`;
		let pageHtml = page.html;

		for (const resource of resources) {
			const basename = resource.path.split('/').pop() ?? '';
			if (basename === '' || basename.toLowerCase() === 'filelist.xml') continue;
			if (!pageHtml.includes(resource.path)) continue;
			const target = `${page.name}_files/${basename}`;
			pageHtml = pageHtml.split(resource.path).join(target);
			push(`${attachmentFolder}/${basename}`, resource.bytes);
		}

		// `onenote:#<title>&section-id=...` is the only link between two pages the export
		// carries. Rewritten to the target's own entry path when that page is in this export,
		// so `onenote.md`'s link rule sees a relation it can ground; left alone otherwise,
		// because a link out of the export is not a relation we can resolve.
		pageHtml = pageHtml.replace(
			/href=(["']?)onenote:#([^"'&>]*)[^"'>]*\1/gi,
			(whole, quote: string, rawTitle: string) => {
				const target = pathByTitle.get(plainText(rawTitle));
				return target === undefined ? whole : `href=${quote}${target}${quote}`;
			}
		);

		// The title goes into an element, so the four characters that could close it early are
		// escaped. A page whose title is empty carries its generated name instead, so the
		// `<title>` a playbook reads is never blank.
		const titleText = (page.title || page.name)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
		const document =
			`<html>\n<head>\n${head.trim()}\n<title>${titleText}</title>\n` +
			`</head>\n${bodyOpen}\n${pageHtml}\n</body>\n</html>\n`;
		push(`${root}/${page.name}.htm`, new Uint8Array(Buffer.from(document, 'utf8')));
	}

	return entries;
}
