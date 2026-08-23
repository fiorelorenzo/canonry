/**
 * Issue #591: one assertion per format OneNote can produce, against the fixture that
 * reproduces that format's real signature (`test/fixtures/onenote-formats/README.md` says
 * how each was made and which bytes of the real corpus it mirrors).
 *
 * The point of sniffing at all is that two of the six formats are valid zips and two are
 * plain text, so an extension is not evidence: before this, a `.docx` uploaded on its own
 * was unpacked into `word/styles.xml` and friends and routed to `generic`, and a `.mht`
 * became one `generic` document and a real job. So every case below is stated twice where
 * it matters: what the bytes say, and what the bytes say when the file is renamed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import {
	hasOneNotePdfProducer,
	isUnreadableUploadFormat,
	OFFERED_UPLOAD_EXTENSIONS,
	sniffUpload,
	UNREADABLE_UPLOAD_FORMATS,
	UPLOAD_ACCEPT_ATTRIBUTE,
	WITHHELD_UPLOAD_EXTENSIONS,
	type UploadFormat
} from './upload-format.js';
import { ArchiveSourceReader, DEFAULT_ARCHIVE_LIMITS } from './archive.js';

const FIXTURES = fileURLToPath(new URL('../test/fixtures/onenote-formats/', import.meta.url));

function fixture(name: string): Uint8Array {
	return new Uint8Array(readFileSync(`${FIXTURES}${name}`));
}

function sniff(name: string): { format: UploadFormat; printedFromOneNote: boolean } {
	return sniffUpload(fixture(name), { unzip: unzipSync });
}

describe('every format OneNote exports is identified from its own bytes (issue #591)', () => {
	const cases: [string, UploadFormat][] = [
		['page.mht', 'onenote-mhtml'],
		['section.mht', 'onenote-mhtml'],
		['notebook.mht', 'onenote-mhtml'],
		['printed.pdf', 'pdf'],
		['printed.xps', 'xps'],
		['page.docx', 'docx'],
		['section.one', 'onestore'],
		['notebook.onetoc2', 'onestore'],
		['notebook.onepkg', 'onepkg']
	];

	for (const [name, format] of cases) {
		it(`${name} sniffs as ${format}`, () => {
			expect(sniff(name).format).toBe(format);
		});
	}

	it('tells an XPS and a DOCX apart even though both are OPC zips', () => {
		// The signature is the payload path, not the extension: `FixedDocSeq.fdseq` against
		// `word/document.xml`. Without the discrimination both would sniff as `zip` and both
		// would be unpacked into their own plumbing, which is the defect this closes.
		expect(sniff('printed.xps').format).toBe('xps');
		expect(sniff('page.docx').format).toBe('docx');
	});

	it('a real export zip is an archive to walk, not a document', () => {
		const archive = zipSync({
			'Ashenport/Handouts/Warden Iset Nour.htm': new TextEncoder().encode('<html></html>')
		});
		expect(sniffUpload(archive, { unzip: unzipSync }).format).toBe('zip');
	});

	it('Markdown and plain text are neither an archive nor a format we refuse', () => {
		const md = new TextEncoder().encode('# Warden Iset Nour\n\nThird of her line.\n');
		expect(sniffUpload(md, { unzip: unzipSync }).format).toBe('other');
		expect(isUnreadableUploadFormat('other')).toBe(false);
	});

	it('a MIME envelope OneNote did not write is a web archive, not a notebook', () => {
		// Issue #592 wrote a reader for OneNote's own export and only for that, so the two
		// metas OneNote writes are what separates the format we read from the one we refuse.
		const saved = new TextEncoder().encode(
			'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="x"\r\n\r\n' +
				'--x\r\nContent-Type: text/html\r\n\r\n<html><head><meta name=Generator ' +
				'content="Microsoft Word 15"></head><body>saved page</body></html>\r\n--x--\r\n'
		);
		expect(sniffUpload(saved, { unzip: unzipSync }).format).toBe('mhtml');
		expect(isUnreadableUploadFormat('mhtml')).toBe(true);
		expect(isUnreadableUploadFormat('onenote-mhtml')).toBe(false);
	});

	it('renaming a file does not change what it is', () => {
		// `sniffUpload` never sees a name, which is the whole design: the calls above would
		// answer identically for a `.one` renamed to `.md`. Stated here as behaviour rather
		// than left implicit in the signature, because the routing this feeds used to be by
		// extension and a renamed file was the way through it.
		for (const [name, format] of [
			['section.one', 'onestore'],
			['page.mht', 'onenote-mhtml']
		] as const) {
			expect(sniffUpload(fixture(name), { unzip: unzipSync }).format).toBe(format);
		}
	});

	it('the two formats with no reader are exactly the ones refused', () => {
		expect([...UNREADABLE_UPLOAD_FORMATS]).toEqual(['mhtml', 'xps']);
		for (const format of ['zip', 'pdf', 'docx', 'other'] as const) {
			expect(isUnreadableUploadFormat(format)).toBe(false);
		}
	});

	it('OneNote\u2019s own binary formats are read rather than refused (issue #603)', () => {
		// They were both in the set above until `onestore.ts` existed. Asserted from the
		// outside, on the two formats rather than on the reader, because the refusal is what
		// a GM met and this is the line that says they no longer do.
		expect(isUnreadableUploadFormat('onestore')).toBe(false);
		expect(isUnreadableUploadFormat('onepkg')).toBe(false);
	});
});

/**
 * Issue #615: the file picker offered `.zip,.mht,.pdf,.docx,.md,.txt` for three issues
 * after the readers behind it changed, so a `.onepkg` was readable and unselectable at
 * once and a Kanka `.json` never was selectable at all. These assertions are what makes
 * that state fail rather than ship: the list and the readers are checked against each
 * other in both directions, so a reader added without touching the picker fails here, and
 * so does an extension offered for a format nothing reads.
 */
describe('the picker offers what this module reads, and only that (issue #615)', () => {
	// Every member of `UploadFormat` has to appear here or this object does not typecheck,
	// which is what keeps the two assertions below exhaustive instead of a snapshot of the
	// union as it stood the day they were written.
	const ALL_FORMATS: Record<UploadFormat, true> = {
		zip: true,
		pdf: true,
		docx: true,
		other: true,
		'onenote-mhtml': true,
		mhtml: true,
		xps: true,
		onestore: true,
		onepkg: true
	};
	const readable = (Object.keys(ALL_FORMATS) as UploadFormat[]).filter(
		(format) => !isUnreadableUploadFormat(format)
	);

	it('offers at least one extension for every format there is a reader for', () => {
		const offered = new Set(Object.values(OFFERED_UPLOAD_EXTENSIONS));
		expect(readable.filter((format) => !offered.has(format))).toEqual([]);
	});

	it('offers no extension for a format with no reader behind it', () => {
		const offeredForNothing = Object.entries(OFFERED_UPLOAD_EXTENSIONS).filter(([, format]) =>
			isUnreadableUploadFormat(format)
		);
		expect(offeredForNothing).toEqual([]);
	});

	it('withholds .xps by decision, and withholds nothing that has a reader', () => {
		// Issue #601 refused the format rather than deferring a reader for it, so this is the
		// decision itself and not an omission: a `.xps` is the same printed notebook its PDF
		// twin is, and that twin is already read. If a reader ever lands, `xps` leaves
		// `UNREADABLE_UPLOAD_FORMATS` and this fails, which is the point.
		expect(WITHHELD_UPLOAD_EXTENSIONS['.xps']).toBe('xps');
		for (const [extension, format] of Object.entries(WITHHELD_UPLOAD_EXTENSIONS)) {
			expect(isUnreadableUploadFormat(format)).toBe(true);
			expect(OFFERED_UPLOAD_EXTENSIONS[extension]).toBeUndefined();
		}
	});

	it('keeps .mht in, because its refusal happens on content and not on the name', () => {
		// The asymmetry with `.xps` above, and the reason the table maps an extension to one
		// format rather than to a set. OneNote's own Single File Web Page and a page a browser
		// saved cannot be told apart by extension, so the extension is offered for the one
		// there is a reader for and the other keeps meeting `refuseUnreadableUpload`.
		expect(OFFERED_UPLOAD_EXTENSIONS['.mht']).toBe('onenote-mhtml');
		expect(isUnreadableUploadFormat('mhtml')).toBe(true);
	});

	it('every extension it offers sniffs as the format it is offered for', () => {
		// The table is grounded in the same fixtures the sniffing itself is checked against,
		// so it cannot claim a mapping the bytes disagree with.
		for (const name of [
			'notebook.mht',
			'printed.pdf',
			'page.docx',
			'section.one',
			'notebook.onetoc2',
			'notebook.onepkg'
		]) {
			const extension = name.slice(name.lastIndexOf('.'));
			expect(sniff(name).format).toBe(OFFERED_UPLOAD_EXTENSIONS[extension]);
		}
		expect(sniff('printed.xps').format).toBe(WITHHELD_UPLOAD_EXTENSIONS['.xps']);
	});

	it('offers .json and .zip for what a Kanka export actually is (SPEC \u00a76.3, \u00a76.9)', () => {
		// The extension this list never had, against the fixture the Kanka playbook's own
		// tests read: a campaign export is a JSON file, which sniffs as `other` because it is
		// one document rather than an archive, and the zip a GM makes of it is an archive.
		const kanka = fileURLToPath(new URL('../test/fixtures/kanka/', import.meta.url));
		const json = new Uint8Array(readFileSync(`${kanka}export/characters.json`));
		expect(sniffUpload(json, { unzip: unzipSync }).format).toBe(OFFERED_UPLOAD_EXTENSIONS['.json']);
		const zip = new Uint8Array(readFileSync(`${kanka}campaign-export.zip`));
		expect(sniffUpload(zip, { unzip: unzipSync }).format).toBe(OFFERED_UPLOAD_EXTENSIONS['.zip']);
	});

	it('offers the text formats the "Something else" guide names, all of them one document', () => {
		// Every extension this table maps to `other` is one document rather than an archive,
		// and none of them is a format with its own reader hiding behind a text-looking name.
		// The guide names plain text, Markdown, HTML, RTF, CSV and JSON, so the picker offers
		// exactly those and the server still decides per file on the bytes.
		const payloads: Record<string, string> = {
			'.md': '# Warden Iset Nour\n',
			'.txt': 'Warden Iset Nour, third of her line.\n',
			'.json': '[{"entity_type":"character","name":"Iset Nour"}]',
			'.csv': 'name,role\nIset Nour,Warden\n',
			'.htm': '<html><body><h1>Ashenport</h1></body></html>',
			'.html': '<html><body><h1>Ashenport</h1></body></html>',
			'.rtf': '{\\rtf1\\ansi Warden Iset Nour\\par}'
		};
		for (const [extension, text] of Object.entries(payloads)) {
			expect(OFFERED_UPLOAD_EXTENSIONS[extension]).toBe('other');
			expect(sniffUpload(new TextEncoder().encode(text), { unzip: unzipSync }).format).toBe(
				'other'
			);
		}
		// And nothing else in the table claims `other`, so the two lists above are the same
		// list and a new text extension cannot be added here without a payload behind it.
		const claimingOther = Object.entries(OFFERED_UPLOAD_EXTENSIONS)
			.filter(([, format]) => format === 'other')
			.map(([extension]) => extension);
		expect(claimingOther.sort()).toEqual(Object.keys(payloads).sort());
	});

	it('is the one definition the two upload inputs read', () => {
		expect(UPLOAD_ACCEPT_ATTRIBUTE).toBe(Object.keys(OFFERED_UPLOAD_EXTENSIONS).join(','));
		expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.onepkg');
		expect(UPLOAD_ACCEPT_ATTRIBUTE).not.toContain('.xps');
	});
});

describe('a printed notebook is recognisable and a DOCX export is not (issue #591)', () => {
	it("reads OneNote out of a PDF's own /Producer, wherever in the file it sits", () => {
		expect(sniff('printed.pdf').printedFromOneNote).toBe(true);
	});

	it('says no for a PDF nothing in this product printed', () => {
		const plain = new TextEncoder().encode(
			'%PDF-1.7\n1 0 obj\n<< /Producer (pdfTeX-1.40.25) >>\nendobj\n'
		);
		expect(sniffUpload(plain).printedFromOneNote).toBe(false);
	});

	it('says no when OneNote is only mentioned in the page text', () => {
		// The claim is provenance, not a substring: a handout that discusses OneNote must not
		// get a warning about a hierarchy it never had. The needle is only believed when a
		// `/Producer` or `/Creator` token sits within 200 bytes in front of it.
		const mentions = new TextEncoder().encode(
			'%PDF-1.7\n4 0 obj\n<< /Length 60 >>\nstream\nBT (I keep my notes in OneNote) Tj ET\nendstream\n'
		);
		expect(hasOneNotePdfProducer(mentions)).toBe(false);
	});

	it('a DOCX carries no provenance, so nothing claims one', () => {
		// Measured against all three of the corpus's `.docx` files: OneNote's DOCX export goes
		// through Word, `docProps/app.xml` says `Microsoft Office Word`, and there is nothing
		// left to read. This pins that we do not invent it.
		expect(sniff('page.docx').printedFromOneNote).toBe(false);
	});
});

describe('openUpload: a single file is one document, not an archive to unpack (issue #591)', () => {
	it('a DOCX becomes one entry rather than eleven OOXML parts', async () => {
		const reader = ArchiveSourceReader.openUpload(fixture('page.docx'), 'The Sunken Archive.docx');
		expect((await reader.list('')).map((e) => e.path)).toEqual(['The Sunken Archive.docx']);
	});

	it('an XPS becomes one entry too, for the refusal to be able to name it', async () => {
		const reader = ArchiveSourceReader.openUpload(fixture('printed.xps'), 'Ashenport.xps');
		expect((await reader.list('')).map((e) => e.path)).toEqual(['Ashenport.xps']);
		expect((await reader.sniffEntry('Ashenport.xps')).format).toBe('xps');
	});

	it('a PDF opens at all, which it did not before', async () => {
		// `open` threw `ArchiveParseError: invalid zip data` on this, and the PDF import guide
		// says "any PDF file, uploaded directly".
		const reader = ArchiveSourceReader.openUpload(fixture('printed.pdf'), 'Ashenport.pdf');
		expect((await reader.list('')).map((e) => e.path)).toEqual(['Ashenport.pdf']);
	});

	it('a OneNote .mht becomes a page tree, because it is one file and many documents', async () => {
		// Issue #592. Treating it as one document would hand a playbook a whole notebook and
		// break SPEC.md §6.1's "the unit of work is one document, never the whole world", so
		// `openUpload` expands it into the tree `onenote.md` already reads. `mhtml.test.ts`
		// covers the expansion itself; this is the seam.
		const reader = ArchiveSourceReader.openUpload(fixture('notebook.mht'), 'Ashenport.mht');
		const top = await reader.list('');
		expect(top).toEqual([{ path: 'Ashenport', kind: 'directory' }]);
		const pages = (await reader.list('Ashenport')).map((e) => e.path);
		expect(pages).toContain('Ashenport/Warden Iset Nour.htm');
		expect(pages).toHaveLength(4);
		expect((await reader.read('Ashenport/Session One.htm')).content).toContain(
			'bribed the tide warden'
		);
	});

	it('a web archive OneNote did not write stays one entry, for the refusal to name', async () => {
		const saved = new Uint8Array(
			Buffer.from(
				'MIME-Version: 1.0\r\nContent-Type: text/html\r\nContent-Location: file:///C:/AB/x.htm' +
					'\r\n\r\n<html><body>saved page</body></html>\r\n',
				'utf8'
			)
		);
		const reader = ArchiveSourceReader.openUpload(saved, 'article.mht');
		expect((await reader.list('')).map((e) => e.path)).toEqual(['article.mht']);
		expect((await reader.sniffEntry('article.mht')).format).toBe('mhtml');
	});

	it('a real zip still goes through the zip reader and its limits', async () => {
		const archive = zipSync({ 'notes/session-one.md': new TextEncoder().encode('# One\n') });
		const reader = ArchiveSourceReader.openUpload(archive, 'vault.zip');
		expect((await reader.list('notes')).map((e) => e.path)).toEqual(['notes/session-one.md']);
	});

	it('an upload over the archive size cap is refused before anything is parsed', () => {
		expect(() =>
			ArchiveSourceReader.openUpload(new Uint8Array(64), 'big.mht', {
				...DEFAULT_ARCHIVE_LIMITS,
				maxArchiveBytes: 32
			})
		).toThrow(/over the 32 byte limit/);
	});

	it('a hostile file name cannot decide where the entry lands', async () => {
		// The name is somebody else's string. A browser only ever sends a leaf, so a path in
		// there is either a bug or an attempt: the directory part is dropped and a name that
		// survives nothing falls back to `upload`.
		const bytes = fixture('printed.pdf');
		const traversal = ArchiveSourceReader.openUpload(bytes, '../../etc/passwd.pdf');
		expect((await traversal.list('')).map((e) => e.path)).toEqual(['passwd.pdf']);

		const nothingLeft = ArchiveSourceReader.openUpload(bytes, '../..');
		expect((await nothingLeft.list('')).map((e) => e.path)).toEqual(['upload']);
	});
});
