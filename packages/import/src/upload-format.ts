/**
 * What an uploaded file actually is, decided from its own bytes (issue #591, SPEC.md
 * §6.1, §6.5, §6.6). Routing an upload by its extension is the defect this module
 * closes: a renamed file slips into a playbook that then burns tokens on it, and a
 * format nobody wrote a reader for reaches the estimate screen with a Start button
 * under it.
 *
 * §6.1's envelope table puts "unpack the export, walk it" on the deterministic side of
 * the line, and deciding which of six things OneNote handed a GM is the same kind of
 * work: a rule with a right answer, not a judgement. §6.5's posture applies too - these
 * are somebody else's bytes, so every check below reads a bounded prefix (or searches
 * for a rare needle and only then looks at its context) and never parses anything it
 * does not have to.
 *
 * The six formats OneNote can produce, and what identifies each of them. Every signature
 * here was read off the 19-file corpus `docs/corpus-onenote.md` documents, not from a
 * specification, and the corresponding fixture in `onenote-fixtures.ts` reproduces it:
 *
 * | format | signature |
 * | --- | --- |
 * | `pdf` | `%PDF-` |
 * | `mhtml` | a `MIME-Version:` header plus a `Content-Type:` header in the same block |
 * | `docx` | a zip whose payload includes `word/document.xml` |
 * | `xps` | a zip whose payload includes `FixedDocSeq.fdseq` |
 * | `onepkg` | `MSCF`, a Microsoft cabinet, which is what a `.onepkg` is |
 * | `onestore` | an [MS-ONESTORE] file GUID: a `.one` section or a `.onetoc2` table of contents |
 *
 * Anything else that parses as a zip is `zip`, an export to unpack and walk. Anything
 * else at all is `other`, one document handed to whichever playbook detection picks.
 *
 * `UNREADABLE_UPLOAD_FORMATS` is the set with no reader behind it, and it is the whole
 * point: a job for one of those must be refused before it is created, because SPEC §15's
 * "no opaque credits" and guardrail 5 both mean a run that cannot succeed may not charge.
 * It has shrunk twice: issue #592 took `mhtml` out for OneNote's own envelopes by writing
 * `mhtml.ts`, and issue #603 took `onestore` and `onepkg` out by writing `onestore.ts`.
 * What is left is a `.mht` no OneNote wrote and an `.xps`, and the `.xps` is refused by
 * decision rather than for want of a reader: its `.pdf` twin is equivalent and already
 * read, measured in `docs/onenote-export.md` (issue #601).
 */

/** Formats this module can tell apart. `zip` is an archive to unpack; `other` is one
 * document whose bytes match none of the signatures above (Markdown, plain text, a
 * JSON export, an HTML page).
 *
 * `onenote-mhtml` and `mhtml` are the same envelope and a different thing: issue #592
 * wrote a reader for OneNote's own Single File Web Page, and only for that, so the
 * distinction is the `ProgId: OneNote.File` meta the product writes into the page HTML.
 * A `.mht` saved by a browser is still an envelope nothing here can turn into a
 * notebook. */
export type UploadFormat =
	'zip' | 'pdf' | 'docx' | 'other' | 'onenote-mhtml' | 'mhtml' | 'xps' | 'onestore' | 'onepkg';

/** The formats with no reader behind them. Ordered as the refusal copy lists them, and
 * narrow on purpose: a format is only in here once it has been confirmed unreadable
 * against a real file, never on the strength of its extension. */
export const UNREADABLE_UPLOAD_FORMATS = ['mhtml', 'xps'] as const;

export type UnreadableUploadFormat = (typeof UNREADABLE_UPLOAD_FORMATS)[number];

/** A fixed table rather than a `Set`: both members are known at authoring time and this
 * is only ever a membership question. */
const UNREADABLE: Record<UnreadableUploadFormat, true> = {
	mhtml: true,
	xps: true
};

export function isUnreadableUploadFormat(format: UploadFormat): format is UnreadableUploadFormat {
	return format in UNREADABLE;
}

/**
 * Which extensions the file picker offers, and the only definition of that list (issue
 * #615). Both upload inputs read it through their `+page.server.ts`, the same way they
 * already read `PLAYBOOK_LABELS`, so the picker cannot drift from the formats this module
 * reads. It had drifted through three issues as two hand-maintained copies in two Svelte
 * files: #591 added the sniffing, #599 and #603 added readers, and none of them touched
 * the literal, so a `.onepkg` ended up readable and unselectable at the same time.
 *
 * The value is the format an extension is offered *for*, which is what makes the list
 * checkable in both directions rather than merely present: `upload-format.test.ts`
 * asserts that every readable `UploadFormat` is reachable from some extension here, so a
 * new reader that does not reach the picker fails, and that no extension is offered for a
 * format in `UNREADABLE_UPLOAD_FORMATS`, so the reverse fails too.
 *
 * `.mht` is the deliberate asymmetry, and it is the reason this table maps to one format
 * rather than to a set. OneNote's Single File Web Page and a page a browser saved share
 * the extension and differ only in their bytes, so the extension is offered for the export
 * issue #592 wrote a reader for, and the browser's copy keeps being refused on content by
 * `refuseUnreadableUpload`. An `.xps` has no such twin: every `.xps` is an `xps`, refused
 * by decision rather than for want of a reader (issue #601, its PDF twin is equivalent and
 * already read), so offering it in the picker in order to reject it politely a step later
 * would be worse than not offering it. `WITHHELD_UPLOAD_EXTENSIONS` carries that decision
 * where the test can read it, instead of leaving it to a comment nobody checks.
 *
 * What is in it is what a guide tells a GM to hand us, checked against what
 * `sniffUpload` and `detectSource` actually do with it: the four named sources' own
 * exports (a zip for World Anvil and for a vault, a `.json` for Kanka, `.one`,
 * `.onetoc2`, `.onepkg` and `.mht` for OneNote), the two document formats with their own
 * playbook, and the text formats the "Something else" guide names by name. Nothing here
 * is aspirational: every extension has a fixture or a corpus file behind the format it
 * claims.
 *
 * It is still only a hint, and the generic guide's "there is no list of allowed
 * extensions" stays true: nothing on the server routes by extension, `readsAsText`
 * decides per file on its bytes, and a GM with an extensionless export can still choose
 * it wherever the platform allows. So this list closes the gap between what a guide asks
 * for and what a picker appears to accept, and it is not a gate.
 *
 * Extensions rather than MIME types, because three of these formats have no registered
 * one: a `.one`, `.onetoc2` or `.onepkg` arrives as `application/octet-stream` from any
 * desktop with no OneNote installed, so a type-based `accept` would filter out exactly the
 * files this issue is about.
 *
 * No folder is offered, because an `<input type="file">` cannot take one. SPEC §6.6 calls
 * an Obsidian vault "folder or zip" and an exported OneNote page tree a folder, and what
 * this input supports is the zip of either, which is what the guides now say.
 */
export const OFFERED_UPLOAD_EXTENSIONS: Readonly<Record<string, UploadFormat>> = {
	'.zip': 'zip',
	'.md': 'other',
	'.txt': 'other',
	'.json': 'other',
	'.csv': 'other',
	'.htm': 'other',
	'.html': 'other',
	'.rtf': 'other',
	'.pdf': 'pdf',
	'.docx': 'docx',
	'.one': 'onestore',
	'.onetoc2': 'onestore',
	'.onepkg': 'onepkg',
	'.mht': 'onenote-mhtml'
};

/** Extensions kept out of the picker on purpose, with the format that decides it. Every
 * entry has to be a format in `UNREADABLE_UPLOAD_FORMATS`: if a reader ever lands for one
 * of these, the test here fails and the exclusion has to be argued again rather than
 * surviving as a line nobody reads. */
export const WITHHELD_UPLOAD_EXTENSIONS: Readonly<Record<string, UploadFormat>> = {
	'.xps': 'xps'
};

/** The `accept` attribute both upload inputs use, built from the table above so the two
 * screens cannot disagree with each other or with the readers. */
export const UPLOAD_ACCEPT_ATTRIBUTE: string = Object.keys(OFFERED_UPLOAD_EXTENSIONS).join(',');

/** What a sniff establishes about one file. `printedFromOneNote` is only ever true for
 * a `pdf`, and is what lets the confirm screen tell a GM that what they uploaded is a
 * printed notebook rather than a notebook - see `hasOneNotePdfProducer` for why the
 * same cannot be said of a `docx`. */
export interface UploadSniff {
	format: UploadFormat;
	printedFromOneNote: boolean;
}

/** How many leading bytes any signature below needs. The MIME header block of the four
 * real `.mht` files is under 200 bytes; this leaves room for a longer preamble without
 * ever decoding a whole upload to find out what it is. */
const SNIFF_PREFIX_BYTES = 4096;

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_HEADER = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_SPANNED_HEADER = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
export const CABINET_MAGIC = Buffer.from('MSCF', 'latin1');

/** [MS-ONESTORE] §2.3.1 `guidFileType`, little-endian on disk. The section GUID is what
 * all three `.one` files in the corpus start with; the table-of-contents GUID is the
 * other half of the same export and is here so a `.onetoc2` is recognised rather than
 * falling through to `other` and being handed to a model as text. */
export const ONESTORE_SECTION_GUID = Buffer.from([
	0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3
]);
export const ONESTORE_TOC_GUID = Buffer.from([
	0xa1, 0x2f, 0xff, 0x43, 0xd9, 0xef, 0x76, 0x4c, 0x9e, 0xe2, 0x10, 0xea, 0x57, 0x22, 0x76, 0x5f
]);

/** A MIME envelope, and whether OneNote wrote it. Both headers are required rather than
 * just `MIME-Version:`, because that one line on its own also opens a saved email and this
 * is a routing decision: the page-scope export in the corpus is a single `text/html` part
 * with `Content-Transfer-Encoding: quoted-printable`, and the section-scope one is
 * `multipart/related`, so the pair is what both shapes share. Leading blank lines are
 * tolerated.
 *
 * The OneNote half looks past the header block for the two metas OneNote writes into every
 * page it exports, `ProgId content=OneNote.File` and `Generator content="Microsoft OneNote
 * 15"`, which together are the only thing distinguishing the export issue #592 wrote a
 * reader for from a page a browser saved. Both are needed: `Generator` alone also appears on
 * Word's HTML export. It searches the raw prefix rather than a decoded document on purpose:
 * quoted-printable leaves `OneNote.File` untouched (there is no `=` in it) and encodes the
 * attribute's own `=` as `=3D`, so the literal survives, and the two metas sit about 400
 * bytes in for a single-part export and about 700 for a multipart one, well inside the
 * prefix this function is given. An export whose head somehow sits past that prefix falls
 * back to plain `mhtml` and is refused, which is the safe direction. */
function sniffMimeEnvelope(prefix: Buffer): UploadFormat | null {
	const text = prefix.toString('latin1');
	const headerBlock = text.slice(0, Math.max(0, text.search(/\r?\n\r?\n/)) || text.length);
	if (!/^\s*MIME-Version:/i.test(headerBlock)) return null;
	if (!/^Content-Type:/im.test(headerBlock)) return null;
	const oneNote =
		/content\s*=\s*(?:3D)?"?OneNote\.File/i.test(text) && /Microsoft OneNote/i.test(text);
	return oneNote ? 'onenote-mhtml' : 'mhtml';
}

/**
 * Whether a PDF's own info dictionary says OneNote printed it. Measured rather than
 * assumed: all three `.pdf` files in the corpus carry `/Producer` and `/Creator` set to
 * "Microsoft OneNote per Microsoft 365", written as UTF-16BE with a byte order mark and
 * left uncompressed, and the dictionary sits wherever the writer put it (6KB into the
 * 173KB page export, 1.3MB into the 2.28MB notebook one), so there is no prefix to
 * bound this to.
 *
 * So it searches for the rare needle first - the string "OneNote", in both encodings the
 * corpus uses - and only then looks backwards a short way for the `/Producer` or
 * `/Creator` token that makes it provenance rather than page content. `Buffer.indexOf`
 * is a memchr scan, so this costs one pass over bytes that are already in memory and
 * allocates nothing.
 *
 * It degrades by saying no. A PDF whose metadata lives inside a compressed object stream
 * is not recognised, and then the confirm screen simply does not show the
 * printed-notebook note. That is the safe direction: the note is a warning about what
 * was lost, and a missing warning is a worse import, while a wrong one would be a lie.
 *
 * There is deliberately no `docx` equivalent. OneNote's DOCX export goes through Word,
 * so `docProps/app.xml` says `Microsoft Office Word` and every trace of OneNote is gone
 * (checked against all three `.docx` files in the corpus). A OneNote DOCX is not
 * distinguishable from any other DOCX, and inventing a heuristic for it would produce
 * exactly the wrong-warning case above.
 */
export function hasOneNotePdfProducer(bytes: Uint8Array): boolean {
	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const needles = [Buffer.from('OneNote', 'latin1'), Buffer.from('OneNote', 'utf16le').swap16()];
	// How far back the `/Producer (` or `/Creator (` token can sit from the vendor name.
	// The corpus's own distance is 34 bytes; this allows a much longer prefix without
	// letting a mention of OneNote in the page text find an unrelated token.
	const CONTEXT_BYTES = 200;
	for (const needle of needles) {
		let at = buffer.indexOf(needle);
		while (at !== -1) {
			const context = buffer
				.subarray(Math.max(0, at - CONTEXT_BYTES), at)
				.toString('latin1')
				.replace(/\0/g, '');
			if (/\/(Producer|Creator)/.test(context)) return true;
			at = buffer.indexOf(needle, at + 1);
		}
	}
	return false;
}

function startsWith(prefix: Buffer, magic: Buffer): boolean {
	return prefix.length >= magic.length && prefix.subarray(0, magic.length).equals(magic);
}

/** Reads a zip's entry names without inflating a single byte, so an OPC document can be
 * told apart from an export to unpack before anything is decompressed. `unzipSync`'s
 * filter callback sees every entry from the central directory and returning `false`
 * everywhere means nothing is ever handed to the inflater - the same trick
 * `ArchiveSourceReader.open` uses to enforce its caps from the central directory alone.
 * A zip this cannot walk is still a zip: it is `ArchiveSourceReader.open`'s job to
 * refuse it with the reason, not this function's to guess. */
function zipEntryNames(bytes: Uint8Array, unzip: UnzipFn): string[] {
	const names: string[] = [];
	try {
		unzip(bytes, {
			filter(file) {
				names.push(file.name);
				return false;
			}
		});
	} catch {
		return names;
	}
	return names;
}

/** The one part of `fflate` this module needs, narrowed to what it calls so that the
 * import stays a type-only concern for every consumer that never sniffs a zip. */
type UnzipFn = (
	data: Uint8Array,
	options: { filter(file: { name: string }): boolean }
) => Record<string, Uint8Array>;

/** OPC payload paths that identify a package. Neither is a guess: `word/document.xml` is
 * in all three corpus `.docx` files, `FixedDocSeq.fdseq` in all three `.xps` files, and
 * no file in the corpus carries both. */
function opcFormat(names: readonly string[]): UploadFormat | null {
	const lower = names.map((n) => n.toLowerCase().replace(/\\/g, '/'));
	if (!lower.includes('[content_types].xml')) return null;
	if (lower.includes('word/document.xml')) return 'docx';
	if (lower.includes('fixeddocseq.fdseq')) return 'xps';
	return null;
}

export interface SniffUploadOptions {
	/** Injected rather than imported so this module stays free of `fflate` for every
	 * caller that only sniffs a non-zip. `ArchiveSourceReader` passes its own
	 * `unzipSync`. */
	unzip?: UnzipFn;
}

/**
 * What this file is. Reads at most `SNIFF_PREFIX_BYTES` for every signature except the
 * two that cannot be bounded: a zip's central directory sits at the end of the file, and
 * a PDF's info dictionary sits wherever its writer put it.
 */
export function sniffUpload(bytes: Uint8Array, options: SniffUploadOptions = {}): UploadSniff {
	const prefix = Buffer.from(
		bytes.buffer,
		bytes.byteOffset,
		Math.min(bytes.byteLength, SNIFF_PREFIX_BYTES)
	);

	if (startsWith(prefix, PDF_MAGIC)) {
		return { format: 'pdf', printedFromOneNote: hasOneNotePdfProducer(bytes) };
	}
	if (startsWith(prefix, CABINET_MAGIC)) {
		return { format: 'onepkg', printedFromOneNote: false };
	}
	if (startsWith(prefix, ONESTORE_SECTION_GUID) || startsWith(prefix, ONESTORE_TOC_GUID)) {
		return { format: 'onestore', printedFromOneNote: false };
	}
	if (
		startsWith(prefix, ZIP_LOCAL_HEADER) ||
		startsWith(prefix, ZIP_EMPTY_HEADER) ||
		startsWith(prefix, ZIP_SPANNED_HEADER)
	) {
		const { unzip } = options;
		const opc = unzip ? opcFormat(zipEntryNames(bytes, unzip)) : null;
		return { format: opc ?? 'zip', printedFromOneNote: false };
	}
	const envelope = sniffMimeEnvelope(prefix);
	if (envelope !== null) return { format: envelope, printedFromOneNote: false };
	return { format: 'other', printedFromOneNote: false };
}
