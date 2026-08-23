import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
	ArchiveEntryExtractionError,
	ArchiveParseError,
	ArchiveSourceReader,
	ArchiveTooLargeError,
	DEFAULT_ARCHIVE_LIMITS,
	PathTraversalError,
	stripHtmlPresentationNoise,
	TooManyEntriesError,
	ZipBombError,
	type ArchiveLimits
} from './archive.js';
import { SourceNotFoundError } from './sources.js';
import { ImageDimensionsTooLargeError, ImageTooLargeError } from './media-store.js';

const PDF_FIXTURE_ROOT = fileURLToPath(new URL('../test/fixtures/pdf/', import.meta.url));
const DOCX_FIXTURE_ROOT = fileURLToPath(new URL('../test/fixtures/docx/', import.meta.url));

function buildZip(files: Record<string, Uint8Array | string>): Uint8Array {
	const zippable: Record<string, Uint8Array> = {};
	for (const [name, content] of Object.entries(files)) {
		zippable[name] = typeof content === 'string' ? new TextEncoder().encode(content) : content;
	}
	return zipSync(zippable, {});
}

function utf8Bom(text: string): Uint8Array {
	return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

function utf16le(text: string): Uint8Array {
	return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function utf16be(text: string): Uint8Array {
	const swapped = Buffer.from(text, 'utf16le');
	swapped.swap16();
	return Buffer.concat([Buffer.from([0xfe, 0xff]), swapped]);
}

async function loadHandoutPdf(): Promise<Uint8Array> {
	return new Uint8Array(await readFile(`${PDF_FIXTURE_ROOT}handout.pdf`));
}

async function loadNotesDocx(): Promise<Uint8Array> {
	return new Uint8Array(await readFile(`${DOCX_FIXTURE_ROOT}notes.docx`));
}

describe('ArchiveSourceReader - real zip handling (issue #25)', () => {
	it('lists, reads and hashes a well-formed archive', async () => {
		const data = buildZip({
			'notes/aldric.md': 'Aldric Voss commands the harbour watch.',
			'images/portrait.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3])
		});
		const reader = ArchiveSourceReader.open(data);

		expect(reader.artefactSha256).toMatch(/^[0-9a-f]{64}$/);

		const rootEntries = await reader.list('');
		expect(rootEntries).toEqual([
			{ path: 'images', kind: 'directory' },
			{ path: 'notes', kind: 'directory' }
		]);

		const notesEntries = await reader.list('notes');
		expect(notesEntries).toEqual([
			{ path: 'notes/aldric.md', kind: 'file', sizeBytes: expect.any(Number) }
		]);

		const read = await reader.read('notes/aldric.md');
		expect(read).toEqual({ content: 'Aldric Voss commands the harbour watch.', truncated: false });

		const binary = await reader.readBinary('images/portrait.png');
		expect(binary.mimeType).toBe('image/png');
		expect(Buffer.from(binary.base64, 'base64')).toEqual(Buffer.from([137, 80, 78, 71, 1, 2, 3]));

		expect(reader.contentHashOf('notes/aldric.md')).toMatch(/^[0-9a-f]{64}$/);
		expect(reader.contentHashOf('notes/aldric.md')).toBe(reader.contentHashOf('notes/aldric.md'));
	});

	it('throws SourceNotFoundError for a path this archive never had', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'a.md': 'hello' }));
		await expect(reader.read('missing.md')).rejects.toThrow(SourceNotFoundError);
	});

	it('reads a real PDF entry through source_read with the documented --- page N --- markers, matching pdf.ts directly', async () => {
		const pdfBytes = await loadHandoutPdf();
		const expectedText = await readFile(`${PDF_FIXTURE_ROOT}handout.expected-text.txt`, 'utf8');
		const reader = ArchiveSourceReader.open(buildZip({ 'handout.pdf': pdfBytes }));

		const read = await reader.read('handout.pdf');
		expect(read.truncated).toBe(false);
		expect(read.content).toBe(expectedText);
		expect(read.content).toContain('--- page 1 ---');
		expect(read.content).toContain('--- page 2 ---');
	});

	it('reads a real DOCX entry through source_read with structure kept, not raw-decoded bytes', async () => {
		const docxBytes = await loadNotesDocx();
		const reader = ArchiveSourceReader.open(buildZip({ 'notes.docx': docxBytes }));

		const read = await reader.read('notes.docx');
		expect(read.truncated).toBe(false);
		expect(read.content).toContain('# Warden Iset Nour');
		expect(read.content).toContain('Keeper of the eastern gate');
		expect(read.content).not.toMatch(/[*_<>]/); // visual styling markup dropped
	});

	it('renders a real PDF page through renderPage instead of throwing, matching renderPdfPage directly', async () => {
		const pdfBytes = await loadHandoutPdf();
		const reader = ArchiveSourceReader.open(buildZip({ 'handout.pdf': pdfBytes }));

		const rendered = await reader.renderPage('handout.pdf', 2);
		expect(rendered.mimeType).toBe('image/jpeg');
		expect(Math.max(rendered.width, rendered.height)).toBe(1568);
		const buffer = Buffer.from(rendered.base64, 'base64');
		expect(buffer[0]).toBe(0xff);
		expect(buffer[1]).toBe(0xd8);
		expect(buffer[2]).toBe(0xff);
	});

	it('reads a PDF entry and then renders one of its pages off the same stored bytes without detaching them', async () => {
		// pdfjs-dist detaches the Uint8Array handed to getDocument; pdf.ts's openDocument
		// copies bytes to guard against that, but this is the seam that actually proves it:
		// the archive stores one Uint8Array per entry and hands the same reference to both
		// extractPdfText and renderPdfPage across two separate calls.
		const pdfBytes = await loadHandoutPdf();
		const reader = ArchiveSourceReader.open(buildZip({ 'handout.pdf': pdfBytes }));

		const firstRead = await reader.read('handout.pdf');
		const rendered = await reader.renderPage('handout.pdf', 2);
		const secondRead = await reader.read('handout.pdf');

		expect(firstRead.content).toBe(secondRead.content);
		expect(rendered.mimeType).toBe('image/jpeg');
	});

	it('wraps a claimed PDF entry that fails to parse in a named ArchiveEntryExtractionError naming the entry', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'bad.pdf': 'not a real pdf' }));
		await expect(reader.read('bad.pdf')).rejects.toThrow(ArchiveEntryExtractionError);
		await expect(reader.read('bad.pdf')).rejects.toThrow(/"bad\.pdf"/);
		await expect(reader.renderPage('bad.pdf', 1)).rejects.toThrow(ArchiveEntryExtractionError);
		await expect(reader.renderPage('bad.pdf', 1)).rejects.toThrow(/"bad\.pdf"/);
	});

	it('wraps a claimed DOCX entry that fails to parse in a named ArchiveEntryExtractionError naming the entry', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'bad.docx': 'not a real docx' }));
		await expect(reader.read('bad.docx')).rejects.toThrow(ArchiveEntryExtractionError);
		await expect(reader.read('bad.docx')).rejects.toThrow(/"bad\.docx"/);
	});

	it('rejects rendering a non-.pdf entry with a named error instead of crashing', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'notes.md': 'just text' }));
		await expect(reader.renderPage('notes.md', 1)).rejects.toThrow(ArchiveEntryExtractionError);
	});

	it('rejects a render whose pixel count exceeds the configured cap, real render, real limit', async () => {
		const pdfBytes = await loadHandoutPdf();
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxRenderedPixels: 1_000_000 };
		const reader = ArchiveSourceReader.open(buildZip({ 'handout.pdf': pdfBytes }), limits);
		await expect(reader.renderPage('handout.pdf', 2)).rejects.toThrow(ImageDimensionsTooLargeError);
	});

	it('rejects a render whose byte size exceeds the configured cap, real render, real limit', async () => {
		const pdfBytes = await loadHandoutPdf();
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxRenderedBytes: 50_000 };
		const reader = ArchiveSourceReader.open(buildZip({ 'handout.pdf': pdfBytes }), limits);
		await expect(reader.renderPage('handout.pdf', 2)).rejects.toThrow(ImageTooLargeError);
	});

	it('truncates a text read over the configured cap and reports it', async () => {
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxTextReadBytes: 10 };
		const reader = ArchiveSourceReader.open(buildZip({ 'big.md': '0123456789ABCDEF' }), limits);
		const read = await reader.read('big.md');
		expect(read.truncated).toBe(true);
		expect(read.content).toBe('0123456789');
	});

	it('rejects a raw archive over the byte size cap before any parsing', () => {
		const data = buildZip({ 'a.md': 'hello world' });
		const limits: ArchiveLimits = {
			...DEFAULT_ARCHIVE_LIMITS,
			maxArchiveBytes: data.byteLength - 1
		};
		expect(() => ArchiveSourceReader.open(data, limits)).toThrow(ArchiveTooLargeError);
	});

	// The three named-error rejections issue #25 exists for (SPEC.md §6.1, §6.5): "zip
	// bombs, path traversal and absurd file counts are rejected before any model sees
	// them." Each uses a real crafted archive, not a mocked check.

	it('rejects a path-traversal entry with a named error, real crafted archive', () => {
		const data = buildZip({
			'notes/ok.md': 'fine',
			'../../../etc/passwd': 'root:x:0:0:root:/root:/bin/bash'
		});
		expect(() => ArchiveSourceReader.open(data)).toThrow(PathTraversalError);
	});

	it('rejects an absolute-path entry with a named error', () => {
		const data = buildZip({ '/etc/shadow': 'hunter2' });
		expect(() => ArchiveSourceReader.open(data)).toThrow(PathTraversalError);
	});

	it('rejects a real zip bomb (a highly compressible entry declaring far more than the per-entry cap) with a named error', () => {
		// 50 MB of zeros compresses to roughly 50 KB (~1000:1) - small on disk, huge if
		// naively inflated. This is a genuine DEFLATE bomb, not a header lie: fflate reads
		// the declared uncompressed size from the central directory before inflating
		// anything, so the check below trips without ever allocating the 50 MB output.
		const bomb = new Uint8Array(50 * 1024 * 1024);
		const data = zipSync({ 'bomb.bin': [bomb, { level: 9 }] }, {});
		const limits: ArchiveLimits = {
			...DEFAULT_ARCHIVE_LIMITS,
			maxEntryUncompressedBytes: 10 * 1024 * 1024
		};
		expect(() => ArchiveSourceReader.open(data, limits)).toThrow(ZipBombError);
	});

	it('rejects an archive whose entries individually pass but cumulatively exceed the total uncompressed cap', () => {
		const chunk = new Uint8Array(2 * 1024 * 1024); // 2 MB each, well under any per-entry cap
		const data = buildZip({ 'a.bin': chunk, 'b.bin': chunk, 'c.bin': chunk, 'd.bin': chunk });
		const limits: ArchiveLimits = {
			...DEFAULT_ARCHIVE_LIMITS,
			maxEntryUncompressedBytes: 4 * 1024 * 1024,
			maxTotalUncompressedBytes: 5 * 1024 * 1024
		};
		expect(() => ArchiveSourceReader.open(data, limits)).toThrow(ZipBombError);
	});

	it('rejects a 20000-file archive with a named error, real crafted archive, at the production entry-count default', () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 20_000; i++) files[`doc-${i}.md`] = '';
		const data = buildZip(files);
		expect(DEFAULT_ARCHIVE_LIMITS.maxEntries).toBeLessThan(20_000);
		expect(() => ArchiveSourceReader.open(data)).toThrow(TooManyEntriesError);
	});

	it('rejects an archive over a lower configured entry-count limit', () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 50; i++) files[`doc-${i}.md`] = '';
		const data = buildZip(files);
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 10 };
		expect(() => ArchiveSourceReader.open(data, limits)).toThrow(TooManyEntriesError);
	});

	it('rejects a NUL byte in an entry name', () => {
		const data = buildZip({ 'ok\u0000.md': 'x' });
		expect(() => ArchiveSourceReader.open(data)).toThrow(PathTraversalError);
	});

	it('rejects garbage that is not a zip file at all with ArchiveParseError', () => {
		const data = new TextEncoder().encode('this is definitely not a zip file');
		expect(() => ArchiveSourceReader.open(data)).toThrow(ArchiveParseError);
	});
});

describe('stripHtmlPresentationNoise (issue #261): OneNote export noise, deterministically', () => {
	const ONENOTE_PAGE =
		'<html xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
		'<head>\n' +
		'<meta http-equiv=Content-Type content="text/html; charset=utf-8">\n' +
		'<title>Sister Harmony Brightbell</title>\n' +
		'<meta name=Generator content="Microsoft OneNote 15">\n' +
		'<style>\n' +
		'p.MsoNormal, li.MsoNormal, div.MsoNormal\n' +
		'\t{margin:0in;\n' +
		'\tfont-size:11.0pt;\n' +
		'\tfont-family:"Calibri",sans-serif;}\n' +
		'</style>\n' +
		'</head>\n' +
		"<body lang=EN-US style='word-wrap:break-word'>\n" +
		'<div style="position:absolute;left:48px;top:115px;width:576px">\n' +
		'<p class=MsoNormal><span style=\'font-family:"Calibri",sans-serif;font-size:11.0pt\'>' +
		'Based near <a href="../Settlements/Millbrook.htm">Millbrook</a>, with a ' +
		'<img src="Sister Harmony Brightbell_files/portrait.png" width=200 height=300>' +
		'</span></p>\n' +
		'</div>\n' +
		'</body>\n' +
		'</html>\n';

	it('drops the <style> block and every style/class/lang attribute', () => {
		const stripped = stripHtmlPresentationNoise(ONENOTE_PAGE);
		expect(stripped).not.toMatch(/<style/i);
		expect(stripped).not.toMatch(/font-family/i);
		expect(stripped).not.toMatch(/\sstyle=/i);
		expect(stripped).not.toMatch(/\sclass=/i);
		expect(stripped).not.toMatch(/\slang=/i);
	});

	it('keeps every <a href>, <img src>, <title> and the tag structure a playbook rule reads', () => {
		const stripped = stripHtmlPresentationNoise(ONENOTE_PAGE);
		expect(stripped).toContain('<a href="../Settlements/Millbrook.htm">Millbrook</a>');
		expect(stripped).toContain('<img src="Sister Harmony Brightbell_files/portrait.png"');
		expect(stripped).toContain('<title>Sister Harmony Brightbell</title>');
		expect(stripped).toContain('<body>');
		expect(stripped).toContain('<div>');
	});

	it('cuts the byte count meaningfully, since the removed noise was most of the page', () => {
		const stripped = stripHtmlPresentationNoise(ONENOTE_PAGE);
		expect(stripped.length).toBeLessThan(ONENOTE_PAGE.length * 0.8);
	});

	it('is a no-op on a page that never carried style/class/lang or a <style> block', () => {
		const plain = '<html><body><p><a href="a.htm">A</a></p></body></html>';
		expect(stripHtmlPresentationNoise(plain)).toBe(plain);
	});
});

describe('stripHtmlPresentationNoise (issue #616): OneNote canvas-table cells that hold no text', () => {
	/** The shape 45 of the corpus's 90 canvas tables have, verbatim apart from the prose:
	 * four columns of which the first and the last are `width:1px` spacers, a 1px
	 * measurement row above and below the content row, and a `rowspan=2` on the last
	 * column's cell in the middle row. */
	const CANVAS_TABLE =
		'<table border=0 cellpadding=0 cellspacing=0 cols=3 valign=top>\n' +
		' <tr>\n' +
		'  <td valign=top><p>&nbsp;</p></td>\n' +
		'  <td valign=top><p></p></td>\n' +
		'  <td valign=top><p></p></td>\n' +
		'  <td valign=top><p></p></td>\n' +
		' </tr>\n' +
		' <tr>\n' +
		'  <td valign=top><p>&nbsp;</p></td>\n' +
		'  <td valign=top><p>Harmony keeps the shrine at Millbrook.</p></td>\n' +
		'  <td valign=top><p></p></td>\n' +
		'  <td rowspan=2 valign=top><p>&nbsp;</p></td>\n' +
		' </tr>\n' +
		' <tr>\n' +
		'  <td valign=top><p>&nbsp;</p></td>\n' +
		'  <td valign=top><p></p></td>\n' +
		'  <td valign=top><p></p></td>\n' +
		' </tr>\n' +
		'</table>\n';

	it('leaves one cell holding the prose, byte for byte, and drops the rest', () => {
		const stripped = stripHtmlPresentationNoise(CANVAS_TABLE);
		expect(stripped).toContain('<p>Harmony keeps the shrine at Millbrook.</p>');
		expect(stripped.match(/<td\b/g)).toHaveLength(1);
		expect(stripped).not.toMatch(/&nbsp;/);
		expect(stripped).toContain('<table border=0 cellpadding=0 cellspacing=0 cols=3 valign=top>');
	});

	it('reaches the row a dropped spacer column was holding open, which needs a second pass', () => {
		// The last row is all empty, but on the first pass the `rowspan=2` above reaches
		// into it, so it can only go once that spacer column has gone.
		expect(stripHtmlPresentationNoise(CANVAS_TABLE).match(/<tr\b/g)).toHaveLength(1);
	});

	it('keeps a blank cell whose column says something in another row, so nothing shifts', () => {
		const data =
			'<table>' +
			'<tr><td>Name</td><td>Age</td><td>Role</td></tr>' +
			'<tr><td>Harmony</td><td></td><td>Cleric</td></tr>' +
			'</table>';
		expect(stripHtmlPresentationNoise(data)).toBe(data);
	});

	it('drops a column that is blank in every row, since no reading depends on it', () => {
		const stripped = stripHtmlPresentationNoise(
			'<table>' +
				'<tr><td>&nbsp;</td><td>Name</td></tr>' +
				'<tr><td>&nbsp;</td><td>Harmony</td></tr>' +
				'</table>'
		);
		expect(stripped).toBe('<table><tr><td>Name</td></tr><tr><td>Harmony</td></tr></table>');
	});

	it('keeps a cell whose only content is the <img> or <a href> a playbook rule reads', () => {
		const withImage =
			'<table><tr><td><img src="page_files/map.png"></td><td>Millbrook</td></tr>' +
			'<tr><td><a href="../Millbrook.htm">M</a></td><td>Harmony</td></tr></table>';
		expect(stripHtmlPresentationNoise(withImage)).toBe(withImage);
	});

	it('leaves a table holding a nested table entirely alone', () => {
		const nested =
			'<table><tr><td>&nbsp;</td><td>' +
			'<table><tr><td>&nbsp;</td><td>Inner</td></tr></table>' +
			'</td></tr><tr><td>&nbsp;</td><td>Outer</td></tr></table>';
		expect(stripHtmlPresentationNoise(nested)).toBe(nested);
	});

	it('never drops a <th>, because a blank header still names its column', () => {
		const headed = '<table><tr><th></th><th>Age</th></tr><tr><td></td><td>31</td></tr></table>';
		expect(stripHtmlPresentationNoise(headed)).toBe(headed);
	});

	it('is a no-op on the HTML the other playbooks read, which carries no table at all', () => {
		const worldAnvil =
			'<html><body><h1>Baron Corvain</h1><p>A <a href="duskwood-vale.html">vale</a>.</p></body></html>';
		expect(stripHtmlPresentationNoise(worldAnvil)).toBe(worldAnvil);
	});
});

describe('ArchiveSourceReader.read scopes the strip to .htm/.html entries only (issue #261)', () => {
	it('strips a .htm entry, leaving its links and title intact', async () => {
		const data = buildZip({
			'notebook/Sister Harmony Brightbell.htm':
				'<html><head><title>Sister Harmony Brightbell</title></head>' +
				'<body><p class=MsoNormal><span style=\'font-family:"Calibri",sans-serif\'>' +
				'See <a href="../Millbrook.htm">Millbrook</a></span></p></body></html>'
		});
		const reader = ArchiveSourceReader.open(data);
		const { content } = await reader.read('notebook/Sister Harmony Brightbell.htm');
		expect(content).not.toMatch(/style=|class=/);
		expect(content).toContain('<a href="../Millbrook.htm">Millbrook</a>');
		expect(content).toContain('<title>Sister Harmony Brightbell</title>');
	});

	it('never touches a non-HTML entry - a Markdown file with a literal "style=" in its prose survives untouched', async () => {
		const markdown = 'The sign reads style="ye olde inn" in flaking gold leaf, class=1 tavern.';
		const data = buildZip({ 'notes/aldric.md': markdown });
		const reader = ArchiveSourceReader.open(data);
		const { content } = await reader.read('notes/aldric.md');
		expect(content).toBe(markdown);
	});
});

describe('ArchiveSourceReader.read honours a byte order mark (issue #311)', () => {
	const TEXT = 'Aldric Voss commands the harbour watch. Cafe au lait, forty gold.';

	it('decodes plain UTF-8 with no BOM exactly as before', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'notes/aldric.md': TEXT }));
		expect(await reader.read('notes/aldric.md')).toEqual({ content: TEXT, truncated: false });
	});

	it('decodes UTF-8 with a BOM and strips it from the returned content', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'notes/aldric.md': utf8Bom(TEXT) }));
		expect(await reader.read('notes/aldric.md')).toEqual({ content: TEXT, truncated: false });
	});

	it('decodes a UTF-16LE entry with its BOM, what a Windows "Unicode" text save produces', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'notes/aldric.md': utf16le(TEXT) }));
		expect(await reader.read('notes/aldric.md')).toEqual({ content: TEXT, truncated: false });
	});

	it('decodes a UTF-16BE entry with its BOM', async () => {
		const reader = ArchiveSourceReader.open(buildZip({ 'notes/aldric.md': utf16be(TEXT) }));
		expect(await reader.read('notes/aldric.md')).toEqual({ content: TEXT, truncated: false });
	});

	it('honours a UTF-16LE BOM on an .htm entry too, before stripHtmlPresentationNoise ever runs', async () => {
		const html = '<html><body><p>See <a href="a.htm">A</a></p></body></html>';
		const reader = ArchiveSourceReader.open(buildZip({ 'notes/page.htm': utf16le(html) }));
		const read = await reader.read('notes/page.htm');
		expect(read.content).toContain('<a href="a.htm">A</a>');
		expect(read.content).not.toContain('\u0000');
	});

	it('truncates a UTF-8 entry at the byte cap and reports it, unchanged from before this fix', async () => {
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxTextReadBytes: 10 };
		const reader = ArchiveSourceReader.open(buildZip({ 'big.md': '0123456789ABCDEF' }), limits);
		expect(await reader.read('big.md')).toEqual({ content: '0123456789', truncated: true });
	});

	it('truncates a UTF-16LE entry at the byte cap, a dangling code unit dropped rather than replaced', async () => {
		// BOM (2 bytes) + an 11-byte cap leaves 9 body bytes: four whole 2-byte code
		// units plus one dangling byte, which Buffer.toString('utf16le') drops rather
		// than turning into U+FFFD - so the content is exactly '0123', not '0123' plus a
		// replacement character that would make this look like a binary file.
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxTextReadBytes: 11 };
		const reader = ArchiveSourceReader.open(
			buildZip({ 'big.md': utf16le('0123456789ABCDEF') }),
			limits
		);
		const read = await reader.read('big.md');
		expect(read).toEqual({ content: '0123', truncated: true });
		expect(read.content).not.toContain('\ufffd');
	});

	it('truncates a UTF-16BE entry at the byte cap the same way, the dangling byte dropped before the swap', async () => {
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxTextReadBytes: 11 };
		const reader = ArchiveSourceReader.open(
			buildZip({ 'big.md': utf16be('0123456789ABCDEF') }),
			limits
		);
		const read = await reader.read('big.md');
		expect(read).toEqual({ content: '0123', truncated: true });
		expect(read.content).not.toContain('\ufffd');
	});
});
