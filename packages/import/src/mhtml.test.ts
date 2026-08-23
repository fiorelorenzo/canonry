/**
 * Issue #592, against the three `.mht` fixtures that reproduce the real corpus's three
 * scopes (`test/fixtures/onenote-formats/README.md`): a single-part page export, a
 * `multipart/related` section export with an image part and a `filelist.xml`, and a
 * single-part notebook export whose pages come from two different sections with nothing
 * between them.
 *
 * The two things this file is actually defending. **Fidelity**: every page becomes its own
 * document with its own title and its own prose, and a link between two pages survives as
 * a link. And **the honest absence of a hierarchy**: the export carries none, so the tree
 * is flat, and a test says so rather than leaving it to be re-guessed later.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	dropInterfaceGlyphImages,
	expandOneNoteMhtml,
	isOneNoteHtml,
	MhtmlLocationError,
	MhtmlParseError,
	MhtmlPartTooLargeError,
	MhtmlTooManyPartsError,
	parseMhtml,
	relativeLocation,
	splitOneNotePages,
	type MhtmlLimits
} from './mhtml.js';

const FIXTURES = fileURLToPath(new URL('../test/fixtures/onenote-formats/', import.meta.url));

const LIMITS: MhtmlLimits = {
	maxParts: 1000,
	maxPartBytes: 8 * 1024 * 1024,
	maxTotalBytes: 32 * 1024 * 1024
};

function fixture(name: string): Uint8Array {
	return new Uint8Array(readFileSync(`${FIXTURES}${name}`));
}

function mainHtml(name: string): string {
	return Buffer.from(parseMhtml(fixture(name), LIMITS).main.bytes).toString('utf8');
}

function expand(name: string, notebookName = name): Map<string, string> {
	const entries = expandOneNoteMhtml(fixture(name), { notebookName, limits: LIMITS });
	return new Map(entries.map((e) => [e.path, Buffer.from(e.bytes).toString('utf8')]));
}

describe('the MIME envelope, in both shapes OneNote writes (issue #592)', () => {
	it('reads a single-part page export and decodes its quoted-printable body', () => {
		const parsed = parseMhtml(fixture('page.mht'), LIMITS);
		expect(parsed.main.contentType).toBe('text/html');
		expect(parsed.resources).toHaveLength(0);
		const html = Buffer.from(parsed.main.bytes).toString('utf8');
		expect(html).toContain('<meta name=ProgId content=OneNote.File>');
		// A soft line break rejoins a word OneNote split mid-token, so "The Sun=\nken"
		// becomes "Sunken" and the newline OneNote wrapped on stays where it was.
		expect(html).toContain('The Sunken');
		expect(html).not.toContain('Sun=');
		// `=C3=A9` is one UTF-8 character, not two escapes.
		expect(html).toContain('caf\u00e9');
		expect(html).not.toContain('=3D');
	});

	it('reads a multipart section export and keeps its resources under their own paths', () => {
		const parsed = parseMhtml(fixture('section.mht'), LIMITS);
		expect(parsed.main.contentType).toBe('text/html');
		expect(parsed.resources.map((r) => `${r.path} ${r.contentType}`).sort()).toEqual([
			'Handouts_file/filelist.xml text/xml',
			'Handouts_file/image001.png image/png',
			'Handouts_file/image002.png image/png'
		]);
		// base64 decoded to real bytes, not to the base64 text. The parse keeps both images:
		// deciding that one of them is an interface glyph is the expansion's job, not the
		// envelope's, because the envelope has no idea how the HTML uses a part.
		for (const png of parsed.resources.filter((r) => r.contentType === 'image/png')) {
			expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		}
	});

	it('recognises OneNote as the author and does not credit it for a browser save', () => {
		expect(isOneNoteHtml(mainHtml('page.mht'))).toBe(true);
		expect(isOneNoteHtml('<html><head><meta name=Generator content="Microsoft Word 15">')).toBe(
			false
		);
	});
});

describe('page splitting is by wrapper depth, and titles come from the first paragraph', () => {
	it('one page at page scope, three at section scope, four at notebook scope', () => {
		expect(splitOneNotePages(mainHtml('page.mht'))).toHaveLength(1);
		expect(splitOneNotePages(mainHtml('section.mht'))).toHaveLength(3);
		expect(splitOneNotePages(mainHtml('notebook.mht'))).toHaveLength(4);
	});

	it('reads each page title, and does not key on the 20pt title font', () => {
		// The real notebook export has 7 of 70 pages whose title paragraph is some other size,
		// and keying on `font-size:20.0pt` found only 63 of them. So the rule is "the first
		// paragraph in the wrapper", and this is the fixture's version of that page.
		expect(splitOneNotePages(mainHtml('notebook.mht')).map((p) => p.title)).toEqual([
			'Warden Iset Nour',
			'The Sunken Archive',
			'Flooded Stacks',
			'Session One'
		]);
	});

	it('a note container inside a page is not a page', () => {
		// The split takes the wrapper style only at depth zero inside `<body>`. Measured across
		// all four real files: every page wrapper is a top-level sibling and none is nested, so
		// depth is what tells a page apart from anything else carrying the same style.
		const nested =
			"<html><body><div style='direction:ltr;border-width:100%'><p>Outer</p>" +
			"<div style='direction:ltr;border-width:100%'><p>Inner</p></div></div></body></html>";
		expect(splitOneNotePages(nested).map((p) => p.title)).toEqual(['Outer']);
	});
});

describe('expansion into the folder tree onenote.md already reads (issue #592)', () => {
	it('one .htm per page, under a folder named after the upload', () => {
		expect([...expand('notebook.mht', 'Ashenport Campaign.mht').keys()].sort()).toEqual([
			'Ashenport Campaign/Flooded Stacks.htm',
			'Ashenport Campaign/Session One.htm',
			'Ashenport Campaign/The Sunken Archive.htm',
			'Ashenport Campaign/Warden Iset Nour.htm'
		]);
	});

	it("each page document carries its own title and its own prose, and nobody else's", () => {
		const tree = expand('notebook.mht', 'Ashenport Campaign.mht');
		const stacks = tree.get('Ashenport Campaign/Flooded Stacks.htm')!;
		expect(stacks).toContain('<title>Flooded Stacks</title>');
		expect(stacks).toContain('permanently underwater');
		expect(stacks).not.toContain('Warden of the lower archive');
		expect(stacks).not.toContain('bribed the tide warden');
	});

	it('every page keeps the ProgId head, which is what detection reads', () => {
		for (const document of expand('notebook.mht').values()) {
			expect(document).toContain('ProgId content=OneNote.File');
		}
	});

	it('the tree is flat, because the export carries no hierarchy', () => {
		// "Flooded Stacks" is a subpage of "The Sunken Archive" in the notebook it came from,
		// and nothing in the bytes says so: no section name, no boundary, no nesting
		// attribute, and the wrapper div byte identical on every page. So no page sits in a
		// folder named after another page, and `onenote.md`'s parent/subpage rule correctly
		// proposes no parent rather than inventing one.
		const paths = [...expand('notebook.mht', 'Ashenport.mht').keys()];
		const pageStems = paths.filter((p) => p.endsWith('.htm')).map((p) => p.replace(/\.htm$/, ''));
		for (const path of paths) {
			const folder = /^(.*)_files\//.exec(path)?.[1];
			if (folder === undefined) continue;
			expect(pageStems).toContain(folder);
		}
		expect(paths.some((p) => /\.htm\//.test(p))).toBe(false);
	});

	it('an embedded resource lands beside the page that references it, and is rewritten to it', () => {
		const tree = expand('section.mht', 'Handouts.mht');
		expect(tree.has('Handouts/The Sunken Archive_files/image001.png')).toBe(true);
		const page = tree.get('Handouts/The Sunken Archive.htm')!;
		expect(page).toContain('src="The Sunken Archive_files/image001.png"');
		expect(page).not.toContain('Handouts_file/image001.png');
		// The page that does not reference it does not get a copy.
		expect(tree.has('Handouts/Flooded Stacks_files/image001.png')).toBe(false);
	});

	it('a note-tag glyph reaches neither the page nor the attachment folder (issue #614)', () => {
		// "Flooded Stacks" carries the 16x16 `alt=Contact` glyph OneNote renders a tagged line
		// with, and "The Sunken Archive" carries a 480x320 picture. Both are `image/png` parts
		// of the same envelope and the same size of file, so nothing but the declared geometry
		// tells them apart, which is the whole point of the rule.
		const tree = expand('section.mht', 'Handouts.mht');
		expect(tree.has('Handouts/Flooded Stacks_files/image002.png')).toBe(false);
		expect([...tree.keys()].some((p) => p.endsWith('image002.png'))).toBe(false);

		const tagged = tree.get('Handouts/Flooded Stacks.htm')!;
		expect(tagged).not.toContain('image002.png');
		expect(tagged).not.toContain('<img');
		// The paragraph the glyph sat at the head of is still there, word for word: the tag
		// went, the tagged line did not.
		expect(tagged).toContain('Watched over by');

		// And the real picture still crosses as an attachment, which is the half of this that
		// must not regress.
		expect(tree.has('Handouts/The Sunken Archive_files/image001.png')).toBe(true);
		expect(tree.get('Handouts/The Sunken Archive.htm')!).toContain(
			'src="The Sunken Archive_files/image001.png"'
		);
	});

	it('an image is dropped on its declared size rather than on its alt text (issue #614)', () => {
		// `alt` is localised: this fixture says `Contact` and the corpus notebook says
		// `Contatto`, so a rule keyed on the vocabulary would be a list that is wrong in every
		// other language OneNote ships. These are the cases that rule has to get right.
		const drop = [
			'<img width=16 height=16 src="x.png">',
			"<img alt='Cosa da fare' width=8 height=8 src='y.png'>",
			'<img width="16" height="16" src="z.png" alt="Importante">'
		];
		for (const tag of drop) {
			expect(dropInterfaceGlyphImages(`<p>a${tag}b</p>`)).toBe('<p>ab</p>');
		}
		// A real picture, a picture that declares nothing, one that declares only a width, and
		// one whose dimension carries a unit rather than a pixel count are all kept: unknown
		// is not small, and no real picture may be lost to this rule.
		const keep = [
			'<img width=480 height=320 src="map.png">',
			'<img src="portrait.png" alt="Contact">',
			'<img width=16 src="banner.png">',
			'<img width=1in height=1in src="inches.png">',
			'<img width=17 height=16 src="just-over.png">'
		];
		for (const tag of keep) {
			expect(dropInterfaceGlyphImages(`<p>a${tag}b</p>`)).toBe(`<p>a${tag}b</p>`);
		}
	});

	it('filelist.xml is dropped rather than enumerated as a document', () => {
		// It is OneNote's own manifest of the parts already parsed, so a document made of it
		// would cost credits to propose nothing.
		expect([...expand('section.mht').keys()].some((p) => /filelist\.xml$/i.test(p))).toBe(false);
	});

	it('a link between two pages in the same export becomes a link between their documents', () => {
		const page = expand('section.mht', 'Handouts.mht').get('Handouts/Flooded Stacks.htm')!;
		expect(page).toContain('href="Handouts/Warden Iset Nour.htm"');
		expect(page).not.toContain('onenote:#');
	});

	it('two pages with the same title get stable distinct paths', () => {
		// Not defensive: one section of the real notebook has two pages called "X Continente
		// Orientale" and two called "X Lunga Terra".
		const twice =
			'<html><head><meta name=ProgId content=OneNote.File></head><body>' +
			"<div style='direction:ltr;border-width:100%'><p>Foresta</p><p>one</p></div>" +
			"<div style='direction:ltr;border-width:100%'><p>Foresta</p><p>two</p></div>" +
			'</body></html>';
		const entries = expandOneNoteMhtml(
			new Uint8Array(
				Buffer.from(
					`MIME-Version: 1.0\r\nContent-Location: file:///C:/AB/x.htm\r\nContent-Type: text/html\r\n\r\n${twice}`,
					'utf8'
				)
			),
			{ notebookName: 'Mondo.mht', limits: LIMITS }
		);
		expect(entries.map((e) => e.path)).toEqual(['Mondo/Foresta.htm', 'Mondo/Foresta (2).htm']);
	});

	it('a page with no title at all still becomes a document', () => {
		// One page of the real notebook export has an empty title paragraph.
		const untitled =
			'MIME-Version: 1.0\r\nContent-Location: file:///C:/AB/x.htm\r\nContent-Type: text/html\r\n\r\n' +
			'<html><head><meta name=ProgId content=OneNote.File></head><body>' +
			"<div style='direction:ltr;border-width:100%'><p>&nbsp;</p><p>orphan note</p></div>" +
			'</body></html>';
		const entries = expandOneNoteMhtml(new Uint8Array(Buffer.from(untitled, 'utf8')), {
			notebookName: 'Mondo.mht',
			limits: LIMITS
		});
		expect(entries.map((e) => e.path)).toEqual(['Mondo/Untitled page 1.htm']);
		expect(Buffer.from(entries[0]!.bytes).toString('utf8')).toContain('orphan note');
	});
});

describe('somebody else\u2019s envelope meets limits, not imagination (issue #592)', () => {
	it('a location that escapes the document is rejected outright, never resolved', () => {
		expect(() => relativeLocation('file:///C:/AB/../../../etc/passwd', 'C:/AB')).toThrow(
			MhtmlLocationError
		);
		expect(() => relativeLocation('file:///C:/AB/x\u0000.png', 'C:/AB')).toThrow(
			MhtmlLocationError
		);
		expect(relativeLocation('file:///C:/AB/Mondo_file/image001.png', 'C:/AB')).toBe(
			'Mondo_file/image001.png'
		);
	});

	it('the part cap stops the walk instead of splitting the whole file first', () => {
		const boundary = '----=_Part';
		const part = `--${boundary}\r\nContent-Location: file:///C:/AB/p.txt\r\nContent-Type: text/plain\r\n\r\nx\r\n`;
		const envelope =
			`MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n` +
			part.repeat(20) +
			`--${boundary}--\r\n`;
		expect(() =>
			parseMhtml(new Uint8Array(Buffer.from(envelope, 'utf8')), { ...LIMITS, maxParts: 5 })
		).toThrow(MhtmlTooManyPartsError);
	});

	it('a part over the per-part cap is refused, on decoded bytes rather than a declared size', () => {
		// MIME declares no sizes, so the cap is on what a part actually decodes to. Neither
		// transfer encoding can expand, so this bounds memory the way the zip reader's
		// declared-size cap does.
		expect(() => parseMhtml(fixture('section.mht'), { ...LIMITS, maxPartBytes: 512 })).toThrow(
			MhtmlPartTooLargeError
		);
	});

	it('the cumulative cap covers the expansion, not only the parse', () => {
		// Above the file's own 4369 bytes, so the parse passes, and below what four page
		// documents plus their repeated `<head>` come to.
		expect(() =>
			expandOneNoteMhtml(fixture('notebook.mht'), {
				notebookName: 'Ashenport.mht',
				limits: { ...LIMITS, maxTotalBytes: 4400 }
			})
		).toThrow(MhtmlPartTooLargeError);
	});

	it('an envelope with no HTML part is refused rather than half read', () => {
		const noHtml =
			'MIME-Version: 1.0\r\nContent-Location: file:///C:/AB/x.txt\r\nContent-Type: text/plain\r\n\r\nhello\r\n';
		expect(() => parseMhtml(new Uint8Array(Buffer.from(noHtml, 'utf8')), LIMITS)).toThrow(
			MhtmlParseError
		);
	});

	it('a OneNote envelope with no page wrappers is refused rather than expanded to nothing', () => {
		const noPages =
			'MIME-Version: 1.0\r\nContent-Location: file:///C:/AB/x.htm\r\nContent-Type: text/html\r\n\r\n' +
			'<html><head><meta name=ProgId content=OneNote.File></head><body><p>hello</p></body></html>';
		expect(() =>
			expandOneNoteMhtml(new Uint8Array(Buffer.from(noPages, 'utf8')), {
				notebookName: 'x.mht',
				limits: LIMITS
			})
		).toThrow(MhtmlParseError);
	});

	it('a multipart envelope that declares a boundary it does not have is refused', () => {
		const lying =
			'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="----=_Nope"\r\n\r\nbody\r\n';
		expect(() => parseMhtml(new Uint8Array(Buffer.from(lying, 'utf8')), LIMITS)).toThrow(
			MhtmlParseError
		);
	});
});
