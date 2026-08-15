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
import { InMemorySourceReader } from '@canonry/import';
import { describe, expect, it } from 'vitest';
import {
	detectSource,
	documentsForPlaybook,
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
