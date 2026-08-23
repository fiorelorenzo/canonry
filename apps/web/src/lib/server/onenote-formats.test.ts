/**
 * Issue #591: what the upload path does with each of the six things OneNote can hand a GM,
 * one case per format, against the fixtures that reproduce each format's real signature
 * (`packages/import/test/fixtures/onenote-formats/README.md`).
 *
 * Measured through the real HTTP upload path first, before any of this existed, and what
 * it did is why this file is here. On its own a `.mht`, a `.pdf`, a `.one` and a `.onepkg`
 * were all refused identically with "archive failed to parse: invalid zip data", because
 * `ArchiveSourceReader.open` is a zip reader and the upload action had no other path; a
 * `.docx` and an `.xps` are OPC, so both parsed as zips, were unpacked into their own
 * plumbing, and reached the estimate screen as eleven and nine `generic` documents with a
 * Start button under them. Inside a zip the three binary formats refused at confirm with
 * "No documents this playbook recognises were found", which is the right outcome announced
 * as though the upload had been empty, and a `.mht` became exactly one `generic` document
 * and a real job: a live run on the corpus's 3.3KB page spent 0.3581 credits and proposed
 * an entity whose body was the string `MIME-Version: 1.0`.
 *
 * So the assertions here are about three things, in the order the upload action does them:
 * the file opens at all, a format with no reader is refused before a `tempId` exists, and
 * a format we do read is routed to the playbook that fits and says what it is.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { ArchiveSourceReader, InMemorySourceReader } from '@canonry/import';
import {
	detectSource,
	documentsForPlaybook,
	refuseUnreadableUpload,
	type KnownPlaybookId
} from './onboarding.js';

const FIXTURES = fileURLToPath(
	new URL('../../../../../packages/import/test/fixtures/onenote-formats/', import.meta.url)
);

function fixture(name: string): Uint8Array {
	return new Uint8Array(readFileSync(`${FIXTURES}${name}`));
}

/** The upload action's own first step: open the bytes the browser sent under the name it
 * sent them with. */
function uploaded(name: string, as = name): ArchiveSourceReader {
	return ArchiveSourceReader.openUpload(fixture(name), as);
}

/** The other shape a GM arrives in, and the one the OneNote guide tells them to take:
 * the same file inside a zip. */
function zipped(name: string, as = name): ArchiveSourceReader {
	return ArchiveSourceReader.openUpload(zipSync({ [as]: fixture(name) }), 'export.zip');
}

describe('a format with no reader is refused before a job exists (issue #591)', () => {
	it('printed.xps uploaded on its own is refused as xps', async () => {
		expect(await refuseUnreadableUpload(uploaded('printed.xps'))).toEqual({
			format: 'xps',
			path: 'printed.xps'
		});
	});

	it('printed.xps inside a zip is refused as xps too', async () => {
		// This is the case that used to reach confirm and be told the upload held no
		// documents, which was not true: it held one file we cannot read.
		expect((await refuseUnreadableUpload(zipped('printed.xps')))?.format).toBe('xps');
	});

	it('a web archive OneNote did not write is refused, naming what it is', async () => {
		// Issue #592 reads OneNote's own Single File Web Page and only that, so a page a
		// browser saved is still a format with no reader here.
		const saved = ArchiveSourceReader.openUpload(
			new TextEncoder().encode(
				'MIME-Version: 1.0\r\nContent-Type: text/html\r\nContent-Location: file:///C:/AB/x.htm' +
					'\r\n\r\n<html><body>saved page</body></html>\r\n'
			),
			'article.mht'
		);
		expect(await refuseUnreadableUpload(saved)).toEqual({
			format: 'mhtml',
			path: 'article.mht'
		});
	});

	it('an xps renamed to .pdf is refused on its bytes, not let through on its name', async () => {
		expect(await refuseUnreadableUpload(uploaded('printed.xps', 'handouts.pdf'))).toEqual({
			format: 'xps',
			path: 'handouts.pdf'
		});
	});

	it('a real export carrying one stray unreadable file still imports', async () => {
		// The refusal is for an upload that is nothing but formats we cannot read. A vault
		// with an `.xps` sitting in it is a vault, and refusing the whole thing over one file
		// would be worse than skipping that file, which `documentsForPlaybook` does.
		const mixed = ArchiveSourceReader.openUpload(
			zipSync({
				'notes/Warden Iset Nour.md': new TextEncoder().encode('# Warden Iset Nour\n'),
				'notes/handouts.xps': fixture('printed.xps')
			}),
			'vault.zip'
		);
		expect(await refuseUnreadableUpload(mixed)).toBeNull();

		const documents = await documentsForPlaybook('generic', mixed);
		expect(documents.map((d) => d.sourcePath)).toEqual(['notes/Warden Iset Nour.md']);
	});
});

describe("OneNote's own binary formats are no longer refused (issue #603)", () => {
	// `section.one`, `notebook.onetoc2` and `notebook.onepkg` were all in
	// `UNREADABLE_UPLOAD_FORMATS` until `onestore.ts` existed, and each had its own line of
	// refusal copy in both locales. What replaces the refusal is not silence: these three
	// fixtures are a real file GUID or cabinet header followed by filler, with no revision
	// store behind them, so they are the case of a format we do read and a file we cannot.
	// The distinction matters to a GM, because one says "export something else" and the
	// other says "this file is damaged", and only one of those is true here.
	for (const name of ['section.one', 'notebook.onetoc2', 'notebook.onepkg']) {
		it(`${name} is no longer refused for its format`, async () => {
			// Not reached through `refuseUnreadableUpload`, because opening it is what fails
			// now, and it fails naming the file rather than the format.
			expect(() => uploaded(name)).toThrow(/could not be read/);
		});

		it(`${name} inside a real export is skipped rather than failing the upload`, async () => {
			// Same principle as the stray `.xps` above, and it matters more here: a notebook
			// exported section by section into one zip must not be lost entirely because one
			// of its sections is truncated.
			const mixed = ArchiveSourceReader.openUpload(
				zipSync({
					'notes/Warden Iset Nour.md': new TextEncoder().encode('# Warden Iset Nour\n'),
					[`notes/${name}`]: fixture(name)
				}),
				'vault.zip'
			);
			expect(await refuseUnreadableUpload(mixed)).toBeNull();
			const documents = await documentsForPlaybook('generic', mixed);
			expect(documents.map((d) => d.sourcePath)).toEqual(['notes/Warden Iset Nour.md']);
		});
	}
});

describe('which provenance raises a scope notice, and which does not (issue #603)', () => {
	// The trees are the same shape by the time detection sees them, deliberately: nothing
	// downstream can tell the two readers apart except these counters, which is why the
	// decision has to live here and be asserted here.
	const files = {
		'Ashenport/Handouts/The Sunken Archive.htm':
			'<html><head><meta name="ProgId" content="OneNote.File">' +
			'<meta name="Generator" content="Microsoft OneNote"><title>The Sunken Archive</title>' +
			'</head><body><p>Three floors below the Council hall.</p></body></html>'
	};

	it('an expanded .mht says the scope is unknown, because the envelope does not record it', async () => {
		const detected = await detectSource(new InMemorySourceReader({ files, oneNoteEnvelopes: 1 }));
		expect(detected.playbookId).toBe('onenote');
		expect(detected.notices).toEqual(['onenote-scope-unknown']);
	});

	it('an expanded .onepkg says nothing, because it is the export that drops nothing', async () => {
		// Measured on the corpus: the `.onepkg` carries every page of both section-scope
		// exports, in the same order and at the same `PageLevel`, where the notebook-scope
		// `.mht` is missing 22 of those 75 pages outright. Warning about its scope would be
		// telling a GM to go and export something worse.
		const detected = await detectSource(new InMemorySourceReader({ files, oneStoreNotebooks: 1 }));
		expect(detected.playbookId).toBe('onenote');
		expect(detected.notices).toEqual([]);
	});

	it('a real exported page tree still says nothing, which is unchanged', async () => {
		const detected = await detectSource(new InMemorySourceReader({ files }));
		expect(detected.notices).toEqual([]);
	});
});

describe("OneNote's own Single File Web Page is read as a page tree (issue #592)", () => {
	const scopes: [string, number][] = [
		['page.mht', 1],
		['section.mht', 3],
		['notebook.mht', 4]
	];

	for (const [name, pages] of scopes) {
		it(`${name} uploaded on its own detects as onenote and enumerates ${pages} page(s)`, async () => {
			const reader = uploaded(name, `Ashenport.mht`);
			expect(await refuseUnreadableUpload(reader)).toBeNull();
			const detected = await detectSource(reader);
			expect(detected.playbookId).toBe('onenote');
			expect(detected.confident).toBe(true);
			expect(detected.detail).toEqual({ kind: 'onenote', pages });
			expect(await documentsForPlaybook('onenote', reader)).toHaveLength(pages);
		});

		it(`${name} inside a zip is expanded too, because the guide says "or zipped"`, async () => {
			const reader = zipped(name, 'exports/Ashenport.mht');
			const detected = await detectSource(reader);
			expect(detected.playbookId).toBe('onenote');
			const documents = await documentsForPlaybook('onenote', reader);
			expect(documents).toHaveLength(pages);
			expect(documents.every((d) => d.sourcePath.startsWith('exports/Ashenport/'))).toBe(true);
		});
	}

	it('detects a notebook with no embedded image at all, which the folder shape could not', async () => {
		// The guide had to warn about this: detection keyed only on a sibling `<page>_files/`
		// folder, so a notebook where no page embeds an image fell through to `generic`. Three
		// of the four real `.mht` files have no resources, so the expansion would have landed
		// in the same hole. `meta name=ProgId content=OneNote.File` is the second signal.
		const reader = uploaded('notebook.mht', 'Ashenport.mht');
		const paths = (await documentsForPlaybook('onenote', reader)).map((d) => d.sourcePath);
		expect(paths.some((p) => p.includes('_files'))).toBe(false);
		expect((await detectSource(reader)).playbookId).toBe('onenote');
	});

	it('each page is its own document, with its own title and nobody else\u2019s prose', async () => {
		const reader = uploaded('notebook.mht', 'Ashenport.mht');
		const documents = await documentsForPlaybook('onenote', reader);
		const stacks = documents.find((d) => d.sourcePath.endsWith('Flooded Stacks.htm'));
		expect(stacks).toBeDefined();
		const content = (await reader.read(stacks!.sourcePath)).content;
		expect(content).toContain('<title>Flooded Stacks</title>');
		expect(content).toContain('permanently underwater');
		expect(content).not.toContain('bribed the tide warden');
	});

	it('an embedded image travels across as an attachment beside its page', async () => {
		const reader = uploaded('section.mht', 'Handouts.mht');
		const documents = await documentsForPlaybook('onenote', reader);
		// The attachment folder is not a document, which is the distinction onenote.md draws.
		expect(documents.map((d) => d.sourcePath).some((p) => p.includes('_files'))).toBe(false);
		const asset = await reader.readBinary('Handouts/The Sunken Archive_files/image001.png');
		expect(asset.mimeType).toBe('image/png');
	});

	it('the tree it produces has no parents, because the export carries none', async () => {
		// "Flooded Stacks" is a subpage of "The Sunken Archive" in the notebook it came from,
		// and nothing in the bytes says so. So no page sits in a folder named after another
		// page and onenote.md's parent/subpage rule proposes no parent, which is the honest
		// answer rather than one derived from indentation.
		const reader = uploaded('notebook.mht', 'Ashenport.mht');
		const paths = (await documentsForPlaybook('onenote', reader)).map((d) => d.sourcePath);
		const pageStems = paths.map((p) => p.replace(/\.htm$/, ''));
		expect(paths.every((p) => p.split('/').length === 2)).toBe(true);
		expect(
			pageStems.some((stem) =>
				pageStems.some((other) => other !== stem && stem.startsWith(`${other}/`))
			)
		).toBe(false);
	});
});

describe('a format we do read is routed to the playbook that fits (issue #591)', () => {
	const routed: [string, KnownPlaybookId, number][] = [
		['printed.pdf', 'pdf', 1],
		['page.docx', 'docx', 1]
	];

	for (const [name, playbookId, documentCount] of routed) {
		it(`${name} uploaded on its own detects as ${playbookId} and enumerates one document`, async () => {
			const reader = uploaded(name);
			const detected = await detectSource(reader);
			expect(detected.playbookId).toBe(playbookId);
			expect(detected.confident).toBe(true);
			expect(await refuseUnreadableUpload(reader)).toBeNull();
			expect(await documentsForPlaybook(playbookId, reader)).toHaveLength(documentCount);
		});
	}

	it('a printed notebook says so, so the GM knows the hierarchy is gone', async () => {
		expect((await detectSource(uploaded('printed.pdf'))).notices).toContain('printed-notebook');
	});

	it('a PDF nothing printed from OneNote carries no notice', async () => {
		const plain = new TextEncoder().encode(
			'%PDF-1.7\n1 0 obj\n<< /Producer (pdfTeX-1.40.25) >>\nendobj\n'
		);
		const reader = ArchiveSourceReader.openUpload(plain, 'players-handout.pdf');
		const detected = await detectSource(reader);
		expect(detected.playbookId).toBe('pdf');
		expect(detected.notices).toEqual([]);
	});

	it('a DOCX export of a OneNote page carries no notice either', async () => {
		// Not an oversight: OneNote's DOCX export goes through Word and leaves no provenance
		// to read, so the honest answer is to say nothing rather than to guess.
		expect((await detectSource(uploaded('page.docx'))).notices).toEqual([]);
	});

	it('a file named .pdf that is not one no longer reaches the pdf playbook', async () => {
		// It used to, and cost a document to fail inside `ArchiveEntryExtractionError`. The
		// bytes here are Markdown, so detection reads them as the Markdown they are.
		const reader = ArchiveSourceReader.openUpload(
			new TextEncoder().encode('# Warden Iset Nour\n\nThird of her line.\n'),
			'The Sunken Archive.pdf'
		);
		expect((await detectSource(reader)).playbookId).not.toBe('pdf');
	});

	it('a bare Markdown file opens, which it did not before', async () => {
		const reader = ArchiveSourceReader.openUpload(
			new TextEncoder().encode('# Session one\n\nThe party bribed the tide warden.\n'),
			'session-one.md'
		);
		const detected = await detectSource(reader);
		expect(detected.playbookId).toBe('obsidian');
		expect(await documentsForPlaybook('obsidian', reader)).toHaveLength(1);
	});

	it('the folder-tree export is still what onenote detects, unchanged', async () => {
		// The `onenote` playbook's input is the page tree, and nothing in this issue touches
		// it. Pinned here because the six formats above all sit next to it now.
		const tree = ArchiveSourceReader.openUpload(
			zipSync({
				'Ashenport/Handouts/Warden Iset Nour.htm': new TextEncoder().encode('<html></html>'),
				'Ashenport/Handouts/The Sunken Archive.htm': new TextEncoder().encode('<html></html>'),
				'Ashenport/Handouts/The Sunken Archive_files/map.png': new Uint8Array([0x89, 0x50])
			}),
			'export.zip'
		);
		const detected = await detectSource(tree);
		expect(detected.playbookId).toBe('onenote');
		expect(detected.detail).toEqual({ kind: 'onenote', pages: 2 });
		expect(detected.notices).toEqual([]);
	});
});

/**
 * Issue #604, and the reason it is a `fix` and not a `feature`: OneNote's whole-notebook
 * export leaves pages out of the file it writes, and the file it writes imports cleanly,
 * so nothing downstream can notice. Measured on the corpus (`docs/onenote-export.md`),
 * where 22 of the 75 pages the two section-scope `.mht` files carry have not one 8-word
 * phrase anywhere in the notebook-scope `.mht` of the same notebook.
 *
 * The confirm screen is therefore the last honest place to say something, and what it may
 * say differs by format, because the evidence does:
 *
 * - a print records its **section** in every page footer, so a print whose first and last
 *   footer name different sections came from a notebook-scope export, and that is a fact
 *   about the file rather than a guess;
 * - a Single File Web Page records **nothing** about scope. Measured, not assumed: at all
 *   three scopes the corpus files carry one identical page-wrapper `div` style, one
 *   `<head>`, one `Main-File` link and no section marker anywhere, so the only difference
 *   is the page count, which cannot tell a large section from a small notebook. The notice
 *   says we cannot tell, and the page count is not pressed into service as a threshold.
 *
 * Neither notice refuses the upload, which is the other half of the issue: the file is
 * well formed and everything in it is importable, so blocking would cost the GM the pages
 * they do still have.
 */
describe('a whole-notebook OneNote export is flagged, never refused (issue #604)', () => {
	it('a print covering more than one section says so, on top of saying it is a print', async () => {
		const detected = await detectSource(uploaded('printed-notebook-scope.pdf'));
		expect(detected.playbookId).toBe('pdf');
		expect(detected.notices).toEqual(['printed-notebook', 'printed-many-sections']);
	});

	it('a print of one section says only that it is a print', async () => {
		const detected = await detectSource(uploaded('printed-section-scope.pdf'));
		expect(detected.notices).toEqual(['printed-notebook']);
	});

	it('neither print is refused, and both still enumerate their documents', async () => {
		for (const name of ['printed-notebook-scope.pdf', 'printed-section-scope.pdf']) {
			const reader = uploaded(name);
			expect(await refuseUnreadableUpload(reader)).toBeNull();
			expect(await documentsForPlaybook('pdf', reader)).toHaveLength(1);
		}
	});

	it('a Single File Web Page says its scope is unknown, at every scope, because it is', async () => {
		for (const name of ['page.mht', 'section.mht', 'notebook.mht']) {
			const detected = await detectSource(uploaded(name, 'Ashenport.mht'));
			expect(detected.notices).toEqual(['onenote-scope-unknown']);
		}
	});

	it('the same envelope inside a zip is flagged too, since the guide offers that shape', async () => {
		const detected = await detectSource(zipped('notebook.mht', 'exports/Ashenport.mht'));
		expect(detected.notices).toEqual(['onenote-scope-unknown']);
	});

	it('a real exported page tree is not flagged, because it loses nothing', async () => {
		// The page tree is produced page by page out of OneNote's own GetHierarchy/Publish
		// calls, so notebook scope costs it nothing and there is no scope question to raise.
		// This is what `oneNoteEnvelopes` is for: after expansion the two shapes look alike.
		const tree = ArchiveSourceReader.openUpload(
			zipSync({
				'Ashenport/Handouts/Warden Iset Nour.htm': new TextEncoder().encode('<html></html>'),
				'Ashenport/Handouts/Warden Iset Nour_files/map.png': new Uint8Array([0x89, 0x50])
			}),
			'export.zip'
		);
		expect(tree.oneNoteEnvelopes).toBe(0);
		expect((await detectSource(tree)).notices).toEqual([]);
	});
});
