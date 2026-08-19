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
