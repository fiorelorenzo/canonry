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
import { ArchiveSourceReader } from '@canonry/import';
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
	const refused: [string, string, string][] = [
		['page.mht', 'mhtml', 'Single File Web Page'],
		['section.mht', 'mhtml', 'Single File Web Page'],
		['notebook.mht', 'mhtml', 'Single File Web Page'],
		['printed.xps', 'xps', 'XPS'],
		['section.one', 'onestore', 'section file'],
		['notebook.onetoc2', 'onestore', 'table of contents'],
		['notebook.onepkg', 'onepkg', 'package']
	];

	for (const [name, format] of refused) {
		it(`${name} uploaded on its own is refused as ${format}`, async () => {
			const refusal = await refuseUnreadableUpload(uploaded(name));
			expect(refusal).toEqual({ format, path: name });
		});

		it(`${name} inside a zip is refused as ${format} too`, async () => {
			// This is the case that used to reach confirm and be told the upload held no
			// documents, which was not true: it held one file we cannot read.
			const refusal = await refuseUnreadableUpload(zipped(name));
			expect(refusal?.format).toBe(format);
		});
	}

	it('names the offending file when the upload was an archive holding only it', async () => {
		const refusal = await refuseUnreadableUpload(
			zipped('page.mht', 'Ashenport/Handouts/The Sunken Archive.mht')
		);
		expect(refusal).toEqual({
			format: 'mhtml',
			path: 'Ashenport/Handouts/The Sunken Archive.mht'
		});
	});

	it('a renamed file is refused on its bytes, not let through on its name', async () => {
		expect(await refuseUnreadableUpload(uploaded('section.one', 'session-notes.md'))).toEqual({
			format: 'onestore',
			path: 'session-notes.md'
		});
		expect(await refuseUnreadableUpload(uploaded('page.mht', 'The Sunken Archive.htm'))).toEqual({
			format: 'mhtml',
			path: 'The Sunken Archive.htm'
		});
	});

	it('a real export carrying one stray unreadable file still imports', async () => {
		// The refusal is for an upload that is nothing but formats we cannot read. A vault
		// with a `.one` sitting in it is a vault, and refusing the whole thing over one file
		// would be worse than skipping that file, which `documentsForPlaybook` does.
		const mixed = ArchiveSourceReader.openUpload(
			zipSync({
				'notes/Warden Iset Nour.md': new TextEncoder().encode('# Warden Iset Nour\n'),
				'notes/old-notebook.one': fixture('section.one')
			}),
			'vault.zip'
		);
		expect(await refuseUnreadableUpload(mixed)).toBeNull();

		const documents = await documentsForPlaybook('generic', mixed);
		expect(documents.map((d) => d.sourcePath)).toEqual(['notes/Warden Iset Nour.md']);
	});

	it('a .mht sitting beside real notes is skipped rather than costing a document', async () => {
		// The measured defect: text, so it read as text, so it was a document, so it was a
		// job. Skipped here instead, on its bytes.
		const mixed = ArchiveSourceReader.openUpload(
			zipSync({
				'notes/session-one.md': new TextEncoder().encode('# Session one\n'),
				'notes/Handouts.mht': fixture('section.mht')
			}),
			'vault.zip'
		);
		const documents = await documentsForPlaybook('generic', mixed);
		expect(documents.map((d) => d.sourcePath)).toEqual(['notes/session-one.md']);
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
		expect((await detectSource(uploaded('printed.pdf'))).notice).toBe('printed-notebook');
	});

	it('a PDF nothing printed from OneNote carries no notice', async () => {
		const plain = new TextEncoder().encode(
			'%PDF-1.7\n1 0 obj\n<< /Producer (pdfTeX-1.40.25) >>\nendobj\n'
		);
		const reader = ArchiveSourceReader.openUpload(plain, 'players-handout.pdf');
		const detected = await detectSource(reader);
		expect(detected.playbookId).toBe('pdf');
		expect(detected.notice).toBeNull();
	});

	it('a DOCX export of a OneNote page carries no notice either', async () => {
		// Not an oversight: OneNote's DOCX export goes through Word and leaves no provenance
		// to read, so the honest answer is to say nothing rather than to guess.
		expect((await detectSource(uploaded('page.docx'))).notice).toBeNull();
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
		expect(detected.notice).toBeNull();
	});
});
