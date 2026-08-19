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
 */
import { estimateImportJob, InMemorySourceReader } from '@canonry/import';
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
		expect(detected.detail).toContain('exported page');
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

	it('is calibrated from the two real jobs #261 measured, not the old flat 0.25-credit guess', async () => {
		// No onenote import_job row exists in a freshly migrated test database, so this
		// exercises the cold-start branch (estimateAveragesFor's own "nobody has ever run
		// this playbook on this deployment yet" case), same as a brand-new deployment.
		const averages = await estimateAveragesFor(db, 'onenote');
		// The real jobs behind #261 spent 2.8826 and 2.7496 credits on their first
		// document - the cold-start average must sit in that neighbourhood, not near the
		// old 0.25 guess that produced a "4 credits" estimate for fourteen documents.
		expect(averages.avgCreditsPerDocument).toBeGreaterThan(2.5);
		expect(averages.avgCreditsPerDocument).toBeLessThan(3.1);
		expect(averages.avgSecondsPerDocument).toBe(20);
	});

	it('feeds a fourteen-document job estimate well above the old 4-credit number that stopped the real job', async () => {
		const averages = await estimateAveragesFor(db, 'onenote');
		const estimate = estimateImportJob({
			documentCount: 14,
			avgCreditsPerDocument: averages.avgCreditsPerDocument,
			avgSecondsPerDocument: averages.avgSecondsPerDocument
		});
		expect(estimate.estimatedCredits).toBeGreaterThan(30);
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
		expect(estimate.estimatedCredits).toBeGreaterThan(5);
	});
});
