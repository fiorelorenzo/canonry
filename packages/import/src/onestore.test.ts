/**
 * The `.one`/`.onepkg` reader (issue #603, epic #590).
 *
 * Split the way the reader is: `oneStoreTree` is the half whose behaviour is ours, so it
 * gets the fixtures, and the wasm half gets the two things that can be asserted without a
 * real notebook, which is that it loads and that it fails honestly. A valid `.one` cannot
 * be hand-authored to fixture size, and `test/fixtures/onestore/README.md` says why.
 *
 * The numbers this reader was actually built against are in `docs/onenote-export.md`,
 * measured on the corpus (`docs/corpus-onenote.md`), which is not in this repository.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	expandOneStore,
	oneStoreTree,
	OneStoreParseError,
	OneStoreTooLargeError,
	type ParsedOneStore
} from './onestore.js';

const LIMITS = { maxTotalBytes: 8 * 1024 * 1024, maxAttachmentBytes: 1024 * 1024 };

function parsed(name: string): ParsedOneStore {
	const url = new URL(`../test/fixtures/onestore/${name}.json`, import.meta.url);
	const raw = JSON.parse(readFileSync(url, 'utf8')) as {
		sections: ParsedOneStore['sections'];
		attachmentsSeen: number;
		attachmentsDropped: number;
	};
	let blobs = Buffer.alloc(0);
	try {
		blobs = readFileSync(new URL(`../test/fixtures/onestore/${name}.blob`, import.meta.url));
	} catch {
		// Most fixtures carry no attachment, and an absent blob file is that rather than an error.
	}
	return {
		sections: raw.sections,
		blobs,
		attachmentsSeen: raw.attachmentsSeen,
		attachmentsDropped: raw.attachmentsDropped
	};
}

function tree(name: string, fileName: string, kind: 'onestore' | 'onepkg') {
	const entries = oneStoreTree(parsed(name), { fileName, kind, limits: LIMITS });
	return new Map(entries.map((entry) => [entry.path, entry.bytes]));
}

function text(name: string, fileName: string, kind: 'onestore' | 'onepkg') {
	return new Map(
		[...tree(name, fileName, kind)].map(([path, bytes]) => [
			path,
			Buffer.from(bytes).toString('utf8')
		])
	);
}

describe('the tree a .one section becomes', () => {
	it('puts a section at the root, because the file carries no notebook', () => {
		// A `.one` holds one section and no notebook name, so wrapping it in an invented
		// notebook folder would add a level the file does not have. `onenote.md`'s parent
		// rule reads the containing folder either way.
		expect([...tree('page-scope', 'Warden Iset Nour.one', 'onestore').keys()]).toEqual([
			'Warden Iset Nour/Warden Iset Nour.htm'
		]);
	});

	it('puts a subpage in a folder named after its parent page, which is the whole point', () => {
		// This is the relation `onenote.md` calls the strongest structural signal it reads
		// from any source, and the `.mht` reader cannot produce it at all: that export
		// carries a byte-identical wrapper on every page. Here it comes from `PageLevel`.
		const paths = [...tree('section-scope', 'Handouts.one', 'onestore').keys()];
		expect(paths).toContain('Handouts/The Sunken Archive.htm');
		expect(paths).toContain('Handouts/The Sunken Archive/Flooded Stacks.htm');
	});

	it('keeps an attachment folder apart from a subpage folder', () => {
		// `onenote.md` warns that a folder named `X` holds X's subpages while `X_files`
		// holds its attachments, and that only the suffix tells them apart. Both exist here
		// as siblings of the same page, which is the case that rule is written for.
		const paths = [...tree('section-scope', 'Handouts.one', 'onestore').keys()];
		expect(paths).toContain('Handouts/The Sunken Archive_files/archive-map.png');
		expect(paths).toContain('Handouts/The Sunken Archive/Flooded Stacks.htm');
	});

	it('suffixes a duplicate title within its own folder, not across the section', () => {
		// Two pages really can share a title: the corpus has two "X Continente Orientale"
		// and two "X Lunga Terra" in one section. Both duplicates here are subpages of the
		// same parent, so the second gets a suffix.
		const paths = [...tree('section-scope', 'Handouts.one', 'onestore').keys()];
		expect(paths).toContain('Handouts/The Sunken Archive/Flooded Stacks.htm');
		expect(paths).toContain('Handouts/The Sunken Archive/Flooded Stacks (2).htm');
	});

	it('names a page whose title is empty rather than emitting a bare .htm', () => {
		// One page of the corpus's notebook export has an empty title paragraph, so this is
		// a real shape and not a defensive one.
		const paths = [...tree('section-scope', 'Handouts.one', 'onestore').keys()];
		expect(paths).toContain('Handouts/Untitled page 4.htm');
	});

	it('extracts the attachment bytes at the offsets the parser reported', () => {
		const entries = tree('section-scope', 'Handouts.one', 'onestore');
		const map = entries.get('Handouts/The Sunken Archive_files/archive-map.png');
		const sketch = entries.get(
			'Handouts/The Sunken Archive/Flooded Stacks_files/stacks-sketch.png'
		);
		expect(map?.byteLength).toBe(256);
		expect(sketch?.byteLength).toBe(233);
		// Real PNGs, so a wrong offset shows up as a broken signature rather than as a
		// length that happens to match.
		expect(Buffer.from(map!.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
		expect(Buffer.from(sketch!.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
	});
});

describe('the tree a .onepkg notebook becomes', () => {
	it('is notebook, section, page, named after the upload for the notebook level', () => {
		const paths = [...tree('notebook-scope', 'Ashenport Campaign.onepkg', 'onepkg').keys()];
		expect(paths).toContain('Ashenport Campaign/Handouts/The Sunken Archive.htm');
		expect(paths).toContain('Ashenport Campaign/The Deep Roads/Warden Iset Nour.htm');
	});

	it('nests a third level under the level-2 page it follows', () => {
		// OneNote allows three page levels, and the corpus only exercises two, so this is
		// the case a corpus measurement cannot defend on its own.
		expect([...tree('notebook-scope', 'Ashenport Campaign.onepkg', 'onepkg').keys()]).toContain(
			'Ashenport Campaign/Handouts/The Sunken Archive/Flooded Stacks/Dry Stair.htm'
		);
	});
});

describe('what a page becomes', () => {
	it('declares OneNote, so detection routes the tree to the onenote playbook', () => {
		// `firstHtmlDeclaresOneNote` reads the `ProgId` and `Generator` metas together. The
		// binary format has no HTML head to pass through, so this reader writes them, and
		// without them a real notebook falls through to `generic`.
		const page = text('page-scope', 'Warden Iset Nour.one', 'onestore').get(
			'Warden Iset Nour/Warden Iset Nour.htm'
		)!;
		expect(page).toContain('content="OneNote.File"');
		expect(page).toContain('Microsoft OneNote');
	});

	it("carries the page's own title in <title>, which is what the playbook reads for a name", () => {
		const page = text('page-scope', 'Warden Iset Nour.one', 'onestore').get(
			'Warden Iset Nour/Warden Iset Nour.htm'
		)!;
		expect(page).toContain('<title>Warden Iset Nour</title>');
	});

	it('turns a hyperlink into an <a> over exactly the anchor text the parser reported', () => {
		const page = text('section-scope', 'Handouts.one', 'onestore').get(
			'Handouts/The Sunken Archive.htm'
		)!;
		expect(page).toContain('>Flooded Stacks</a>');
	});

	it('rewrites a link between two pages of the same upload to the target entry path', () => {
		// `onenote.md` treats a link to another page in the export as a candidate relation,
		// so it has to resolve to a path `source_read` can open. Resolved by page id here,
		// which is what works inside a `.onepkg`.
		const page = text('section-scope', 'Handouts.one', 'onestore').get(
			'Handouts/The Sunken Archive.htm'
		)!;
		expect(page).toContain('href="Handouts/The Sunken Archive/Flooded Stacks.htm"');
		expect(page).not.toContain('onenote:#');
	});

	it('resolves a link by title when the id is not one of this upload\u2019s pages', () => {
		// Measured on the corpus: the `page-id` in an `onenote:` link matches a page's own
		// id inside a `.onepkg` and never inside a bare `.one`, so title is the fallback
		// that has to work. The fixture's title is percent-encoded, as OneNote writes it.
		const page = text('notebook-scope', 'Ashenport Campaign.onepkg', 'onepkg').get(
			'Ashenport Campaign/The Deep Roads/Warden Iset Nour.htm'
		)!;
		expect(page).toContain('href="Ashenport Campaign/Handouts/The Sunken Archive.htm"');
	});

	it('nests an indented list rather than leaning on a style attribute', () => {
		// `stripHtmlPresentationNoise` deletes every `style` attribute before a page reaches
		// a prompt, so indentation expressed that way would simply vanish.
		const page = text('section-scope', 'Handouts.one', 'onestore').get(
			'Handouts/The Sunken Archive/Flooded Stacks.htm'
		)!;
		expect(page).toContain('<li>Salt damage to the ledgers</li>');
		// The indented item sits inside a nested list of its own.
		expect(page).toContain('<ul>\n<li>Two shelves permanently submerged</li>\n</ul>');
		// And the numbered run that follows is its own list rather than more of the bulleted
		// one, which is what a marker change at the same depth has to produce.
		expect(page).toContain('<ol>\n<li>First: bail the west aisle</li>\n</ol>');
	});

	it('renders a table as a table', () => {
		const page = text('section-scope', 'Handouts.one', 'onestore').get(
			'Handouts/The Sunken Archive/Flooded Stacks (2).htm'
		)!;
		expect(page).toContain('<td><p>Tide</p></td>');
		expect(page).toContain('<td><p>Four feet</p></td>');
	});

	it('points an <img> into its own page\u2019s _files folder', () => {
		const page = text('section-scope', 'Handouts.one', 'onestore').get(
			'Handouts/The Sunken Archive.htm'
		)!;
		expect(page).toContain('<img src="The Sunken Archive_files/archive-map.png"');
		expect(page).toContain('alt="The dry stair"');
	});

	it('escapes a page title so it cannot close the element it sits in', () => {
		const injected: ParsedOneStore = {
			sections: [
				{
					name: 'Handouts',
					pages: [
						{
							title: '</title><script>alert(1)</script>',
							level: 1,
							id: '',
							created: 0,
							updated: 0,
							blocks: [{ k: 'p', text: 'x <b>y</b> & z', links: [], indent: 0, list: null }],
							assets: []
						}
					]
				}
			],
			blobs: Buffer.alloc(0),
			attachmentsSeen: 0,
			attachmentsDropped: 0
		};
		const entries = oneStoreTree(injected, {
			fileName: 'Handouts.one',
			kind: 'onestore',
			limits: LIMITS
		});
		const page = Buffer.from(entries[0]!.bytes).toString('utf8');
		expect(page).not.toContain('<script>');
		expect(page).toContain('&lt;script&gt;');
		expect(page).toContain('x &lt;b&gt;y&lt;/b&gt; &amp; z');
		// The title also became a path, so the characters a path check rejects are gone.
		expect(entries[0]!.path).not.toContain('<');
	});
});

describe('limits', () => {
	it('refuses an expansion that would exceed the cumulative byte cap', () => {
		expect(() =>
			oneStoreTree(parsed('section-scope'), {
				fileName: 'Handouts.one',
				kind: 'onestore',
				limits: { maxTotalBytes: 600, maxAttachmentBytes: 1024 }
			})
		).toThrow(OneStoreTooLargeError);
	});
});

describe('the wasm half', () => {
	it('loads and reports a file it cannot parse as a parse error, not a crash', () => {
		// `onenote-formats/section.one` is a real [MS-ONESTORE] file GUID followed by filler,
		// which is exactly what detection needs and not a revision store. So this is the
		// error path, and it is worth a test because it is the one that proves in CI that
		// the committed artefact decompresses, compiles, instantiates and runs: a trap or a
		// failed instantiation would not surface as this error.
		const data = readFileSync(
			new URL('../test/fixtures/onenote-formats/section.one', import.meta.url)
		);
		expect(() =>
			expandOneStore(new Uint8Array(data), {
				fileName: 'section.one',
				kind: 'onestore',
				limits: LIMITS
			})
		).toThrow(OneStoreParseError);
	});

	it('says which file and what the parser said, so a GM is told something true', () => {
		const data = readFileSync(
			new URL('../test/fixtures/onenote-formats/notebook.onepkg', import.meta.url)
		);
		let message = '';
		try {
			expandOneStore(new Uint8Array(data), {
				fileName: 'notebook.onepkg',
				kind: 'onepkg',
				limits: LIMITS
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('onepkg file could not be read');
	});
});
