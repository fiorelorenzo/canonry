/**
 * Issue #162: a OneNote export imports nothing, silently. `detectSource` had no branch for
 * the shape (a tree of `.htm` files with sibling `<page>_files/` folders holding their
 * embedded attachments), so an uploaded notebook fell through to `generic`, and
 * `documentsForPlaybook('generic', ...)` enumerates only `.md`/`.txt` - a well-formed
 * export produced zero documents and the GM saw a finished job with nothing in it.
 *
 * `InMemorySourceReader` stands in for the real `ArchiveSourceReader` - both implement
 * `SourceReader`, and `detectSource`/`documentsForPlaybook` only ever call `list`/`read` on
 * the interface, never anything archive-specific. The path shape mirrors the real,
 * hand-made fixture at `packages/import/test/fixtures/onenote/export/`: two top-level
 * pages, one of them (`The Sunken Archive`) with both its own attachment folder and a
 * subpage folder holding `Flooded Stacks.htm`.
 *
 * Issue #305 is the same silent-nothing failure without the OneNote shape: the generic
 * branch of `documentsForPlaybook` enumerated only `.md`/`.txt` too, so the last describe
 * in this file covers what a document means for an arbitrary generic upload.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { ArchiveSourceReader, estimateImportJob, InMemorySourceReader } from '@canonry/import';
import { closeDb, createDb, type Db } from '@canonry/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	detectSource,
	documentsForPlaybook,
	estimateAveragesFor,
	KNOWN_PLAYBOOK_IDS,
	PLAYBOOK_LABELS
} from './onboarding.js';

const WARDEN_PATH = 'Ashenport Campaign/Handouts/Warden Iset Nour.htm';
const ARCHIVE_PATH = 'Ashenport Campaign/Handouts/The Sunken Archive.htm';
const STACKS_PATH = 'Ashenport Campaign/Handouts/The Sunken Archive/Flooded Stacks.htm';
// Not a real OneNote page: a stray .htm sitting inside an attachment folder rather than
// beside one, exercising documentsForPlaybook's defensive "not a _files segment" filter.
const STRAY_HTM_IN_ATTACHMENT_FOLDER =
	'Ashenport Campaign/Handouts/The Sunken Archive_files/backup.htm';

function onenotePage(title: string): string {
	return (
		`<html xmlns:o="urn:schemas-microsoft-com:office:office">\n<head>\n` +
		`<meta http-equiv=Content-Type content="text/html; charset=utf-8">\n<title>${title}</title>\n` +
		`<meta name=Generator content="Microsoft OneNote 15">\n<style>\np.MsoNormal { margin:0in; font-size:11.0pt; font-family:"Calibri",sans-serif; }\n</style>\n` +
		`</head>\n<body lang=EN-US style='word-wrap:break-word'>\n` +
		`<div style="position:absolute;left:48px;top:115px;width:576px">\n` +
		`<p class=MsoNormal><span style='font-family:"Calibri",sans-serif;font-size:11.0pt'>Some notes about ${title}.</span></p>\n` +
		`</div>\n</body>\n</html>\n`
	);
}

const ONENOTE_EXPORT = new InMemorySourceReader({
	files: {
		[WARDEN_PATH]: onenotePage('Warden Iset Nour'),
		[ARCHIVE_PATH]: onenotePage('The Sunken Archive'),
		[STACKS_PATH]: onenotePage('Flooded Stacks'),
		[STRAY_HTM_IN_ATTACHMENT_FOLDER]: onenotePage('backup')
	},
	binaries: {
		'Ashenport Campaign/Handouts/The Sunken Archive_files/archive-map.png': {
			mimeType: 'image/png',
			base64: ''
		},
		'Ashenport Campaign/Handouts/The Sunken Archive/Flooded Stacks_files/stacks-sketch.png': {
			mimeType: 'image/png',
			base64: ''
		}
	}
});

describe('onenote export detection and enumeration (issue #162)', () => {
	it('KNOWN_PLAYBOOK_IDS and PLAYBOOK_LABELS both carry an onenote entry', () => {
		expect(KNOWN_PLAYBOOK_IDS).toContain('onenote');
		expect(PLAYBOOK_LABELS.onenote).toBe('OneNote');
	});

	it('detectSource recognises a tree of .htm pages with a sibling _files/ folder as onenote', async () => {
		const detected = await detectSource(ONENOTE_EXPORT);
		expect(detected.playbookId).toBe('onenote');
		expect(detected.confident).toBe(true);
		expect(detected.detail).toEqual({ kind: 'onenote', pages: 4 });
	});

	it('documentsForPlaybook enumerates exactly the three real pages, not the attachment folders', async () => {
		const docs = await documentsForPlaybook('onenote', ONENOTE_EXPORT);
		expect(docs.map((d) => d.sourcePath).sort()).toEqual(
			[WARDEN_PATH, ARCHIVE_PATH, STACKS_PATH].sort()
		);
	});
});

describe('estimateAveragesFor cold start for onenote (issue #261)', () => {
	const DATABASE_URL =
		process.env.TEST_DATABASE_URL ??
		process.env.DATABASE_URL ??
		'postgres://canonry:canonry@127.0.0.1:55432/canonry';
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 3 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('is calibrated from the real jobs #330 measured, not the old flat 0.25-credit guess', async () => {
		// No onenote import_job row exists in a freshly migrated test database, so this
		// exercises the cold-start branch (estimateAveragesFor's own "nobody has ever run
		// this playbook on this deployment yet" case), same as a brand-new deployment.
		const averages = await estimateAveragesFor(db, 'onenote');
		// #330 re-derived this off two real `.mht` jobs of a real notebook, 93 documents for
		// 106.8722 credits, so the row is 1.1492 rather than #261's 2.816: that constant was
		// measured before #313 priced cached input, and half of every input token it billed
		// as fresh had been served from Gemini's cache. The band still has to exclude the old
		// 0.25 guess that produced a "4 credits" estimate for fourteen documents.
		expect(averages.avgCreditsPerDocument).toBeGreaterThan(1);
		expect(averages.avgCreditsPerDocument).toBeLessThan(1.3);
		expect(averages.avgSecondsPerDocument).toBe(20);
	});

	it('feeds a fourteen-document job estimate well above the old 4-credit number that stopped the real job', async () => {
		const averages = await estimateAveragesFor(db, 'onenote');
		const estimate = estimateImportJob({
			documentCount: 14,
			avgCreditsPerDocument: averages.avgCreditsPerDocument,
			avgSecondsPerDocument: averages.avgSecondsPerDocument
		});
		// 17 on today's constant, against 40 before #330 and the 4 that killed the real job.
		// The bound is "more than a credit a document" rather than the literal, which
		// `packages/import/src/estimate.test.ts` already pins.
		expect(estimate.estimatedCredits).toBeGreaterThan(14);
	});

	it('issue #272: obsidian is no longer stuck at its old 1-credit-for-three-documents guess', async () => {
		// The exact failure Main hit driving the real UI: a 3-note Obsidian vault stopped
		// at the ceiling after one document because only onenote's row had been
		// recalibrated. Every playbook's cold-start row now comes from
		// @canonry/import's estimate.ts, not a second private copy.
		const averages = await estimateAveragesFor(db, 'obsidian');
		const estimate = estimateImportJob({
			documentCount: 3,
			avgCreditsPerDocument: averages.avgCreditsPerDocument,
			avgSecondsPerDocument: averages.avgSecondsPerDocument
		});
		// 4 on today's constant, against 9 before #330 and the 1 that produced the failure.
		expect(estimate.estimatedCredits).toBeGreaterThan(3);
	});
});

/**
 * Issue #305: `documentsForPlaybook('generic', ...)` shared obsidian's `.md`/`.txt`
 * filter, so every other format the generic guide names (HTML, RTF, CSV, "a folder of
 * mixed files, anything readable") enumerated zero documents and the job finished having
 * proposed nothing. These drive the real `ArchiveSourceReader` rather than
 * `InMemorySourceReader`: what the rule turns on is what an entry's bytes decode to, and
 * the in-memory double only holds strings, so a real zip is the only way to hand
 * enumeration a genuine PNG or a genuine invalid-UTF-8 blob.
 */
describe('generic upload enumeration (issue #305)', () => {
	const encoder = new TextEncoder();
	// A real PNG header: the eight-byte signature, then the IHDR length, which is where
	// the NUL bytes a text sniff sees come from.
	const PNG_BYTES = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
	]);
	// A JPEG's first bytes carry no NUL, so this is the case the replacement-character
	// share catches rather than the NUL check: none of it is valid UTF-8.
	const JPEG_BYTES = new Uint8Array([
		0xff, 0xd8, 0xff, 0xe0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8
	]);

	const MIXED_UPLOAD: Record<string, Uint8Array> = {
		'Ashgate/world.html': encoder.encode(
			'<html><head><title>The Ashgate Trading Post</title></head><body>' +
				'<p>Sera Bellweather keeps the post on the north road.</p></body></html>'
		),
		'Ashgate/people.csv': encoder.encode(
			'name,role\nSera Bellweather,trader\nTorvin Hale,carter\n'
		),
		'Ashgate/handout.rtf': encoder.encode('{\\rtf1\\ansi Sera keeps the peace herself.\\par}'),
		'Ashgate/session-notes.txt': encoder.encode('The party reached Ashgate at dusk.\n'),
		'Ashgate/regions/north-road.md': encoder.encode('# The North Road\n\nTwo days ride.\n'),
		// No extension at all, and text: a document, because the rule is about the bytes.
		'Ashgate/README': encoder.encode('Everything in here came out of my old notes app.\n'),
		'Ashgate/map.png': PNG_BYTES,
		'Ashgate/portrait.jpg': JPEG_BYTES,
		'Ashgate/.DS_Store': PNG_BYTES,
		'Ashgate/.obsidian/workspace.json': encoder.encode('{"main":{}}'),
		'Ashgate/empty.txt': encoder.encode(''),
		'Ashgate/blank.txt': encoder.encode('   \n\t\n'),
		'__MACOSX/Ashgate/._world.html': encoder.encode('resource fork')
	};

	const TEXT_PATHS = [
		'Ashgate/README',
		'Ashgate/handout.rtf',
		'Ashgate/people.csv',
		'Ashgate/regions/north-road.md',
		'Ashgate/session-notes.txt',
		'Ashgate/world.html'
	];

	function mixedUpload(): ArchiveSourceReader {
		return ArchiveSourceReader.open(zipSync(MIXED_UPLOAD));
	}

	it('enumerates every readable file, at any depth, whatever its extension', async () => {
		const docs = await documentsForPlaybook('generic', mixedUpload());
		expect(docs.map((d) => d.sourcePath).sort()).toEqual(TEXT_PATHS);
	});

	it('skips binary, hidden and empty files rather than proposing from their bytes', async () => {
		const docs = await documentsForPlaybook('generic', mixedUpload());
		const paths = docs.map((d) => d.sourcePath);
		for (const skipped of [
			'Ashgate/map.png',
			'Ashgate/portrait.jpg',
			'Ashgate/.DS_Store',
			'Ashgate/.obsidian/workspace.json',
			'Ashgate/empty.txt',
			'Ashgate/blank.txt',
			'__MACOSX/Ashgate/._world.html'
		]) {
			expect(paths, `${skipped} should not be a document`).not.toContain(skipped);
		}
	});

	it('numbers the documents it keeps contiguously, with no gap where a file was skipped', async () => {
		// `JobDocument.id` is the key the job's own checkpoint is written under, so a gap
		// would be a real defect rather than a cosmetic one.
		const docs = await documentsForPlaybook('generic', mixedUpload());
		expect(docs.map((d) => d.id)).toEqual(docs.map((_, i) => `doc-${i + 1}`));
	});

	it('is the same upload the old rule found nothing in', async () => {
		// The pre-#305 rule was obsidian's, shared: `.md`/`.txt` only, minus `.obsidian`.
		// Applied to this upload it matches session-notes.txt and north-road.md and nothing
		// else, and applied to an HTML-and-CSV-only upload it matches nothing at all, which
		// is the silent-nothing failure this issue is about.
		const htmlAndCsvOnly = ArchiveSourceReader.open(
			zipSync({
				'Ashgate/world.html': MIXED_UPLOAD['Ashgate/world.html']!,
				'Ashgate/people.csv': MIXED_UPLOAD['Ashgate/people.csv']!,
				'Ashgate/map.png': PNG_BYTES
			})
		);
		const docs = await documentsForPlaybook('generic', htmlAndCsvOnly);
		expect(docs.map((d) => d.sourcePath).sort()).toEqual([
			'Ashgate/people.csv',
			'Ashgate/world.html'
		]);
		expect(docs.filter((d) => /\.(md|txt)$/i.test(d.sourcePath))).toEqual([]);
	});

	it('counts a PDF sitting in a mixed folder, because the reader really does extract its text', async () => {
		const pdfBytes = await readFile(
			fileURLToPath(
				new URL('../../../../../packages/import/test/fixtures/pdf/handout.pdf', import.meta.url)
			)
		);
		const reader = ArchiveSourceReader.open(
			zipSync({
				'Ashgate/notes.txt': MIXED_UPLOAD['Ashgate/session-notes.txt']!,
				'Ashgate/handout.pdf': new Uint8Array(pdfBytes)
			})
		);
		const docs = await documentsForPlaybook('generic', reader);
		expect(docs.map((d) => d.sourcePath).sort()).toEqual([
			'Ashgate/handout.pdf',
			'Ashgate/notes.txt'
		]);
	});

	it('leaves the obsidian rule alone: the same upload still enumerates only its .md/.txt', async () => {
		// Untouched by #305, including the part that differs from the generic rule: the
		// obsidian branch filters by extension and never reads a file, so it still counts an
		// empty note as a document. A vault is a vault, and a `.md` a GM has not written into
		// yet is a note they are about to, not an accident of a mixed folder.
		const docs = await documentsForPlaybook('obsidian', mixedUpload());
		expect(docs.map((d) => d.sourcePath).sort()).toEqual([
			'Ashgate/blank.txt',
			'Ashgate/empty.txt',
			'Ashgate/regions/north-road.md',
			'Ashgate/session-notes.txt'
		]);
	});
});
