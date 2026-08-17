import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { InMemorySourceReader } from '../sources.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../../test/fixtures/pdf/', import.meta.url));
const PDF_PATH = 'handout.pdf';

/**
 * `handout.pdf` (checked in, issue #46) is a real 2-page PDF: page 1 has a genuine text
 * layer (built with pandoc/weasyprint), page 2 is a rendered image with no text layer at
 * all (built with Pillow, merged in with `pdfunite`), i.e. a scanned page. There is no
 * real PDF renderer wired up yet (issue #39 is unclaimed, confirmed with ImportPipeline
 * over IRC), so this test supplies the reader's two halves directly rather than
 * pretending a text-extraction/rendering step ran: `handout.expected-text.txt` is
 * `pdftotext`'s actual output for page 1, reformatted into the `--- page N ---`
 * convention pdf.md documents, and `handout-page2.png` is `pdftoppm`'s actual render of
 * page 2 of this exact PDF - both derived from the checked-in binary, not fabricated.
 */
async function buildPdfSourceReader(): Promise<InMemorySourceReader> {
	const text = await readFile(`${FIXTURE_ROOT}handout.expected-text.txt`, 'utf8');
	const pageImage = await readFile(`${FIXTURE_ROOT}handout-page2.png`);
	return new InMemorySourceReader({
		files: { [PDF_PATH]: text },
		pages: {
			[`${PDF_PATH}#2`]: {
				mimeType: 'image/png',
				base64: pageImage.toString('base64'),
				width: 850,
				height: 1100
			}
		}
	});
}

describe('pdf playbook (issue #39, SPEC.md §6.6)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('pdf');
		expect(playbook.id).toBe('pdf');
		expect(playbook.tools).toContain('page_image');
	});

	it('reads page 1 as text and looks at page 2 through page_image, since it has none', async () => {
		const playbook = await loadBuiltinPlaybook('pdf');
		const sources = await buildPdfSourceReader();
		const { content: text } = await sources.read(PDF_PATH);

		expect(text).not.toContain('Warden Iset Nour'); // page 2's text is genuinely absent, only its image carries this fact
		const archiveSpan = findSpan(text, 'The Sunken Archive is a flooded lower level');
		const page2MarkerSpan = findSpan(text, '--- page 2 ---');

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: PDF_PATH },
			sources,
			steps: [
				toolCallStep([{ id: 't1', name: 'source_read', input: { path: PDF_PATH } }]),
				// page 2's text came back empty: look at it instead of guessing
				toolCallStep([{ id: 't2', name: 'page_image', input: { path: PDF_PATH, page: 2 } }]),
				toolCallStep([
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'place',
							name: 'The Sunken Archive',
							aliases: [],
							summary: 'A flooded lower level of the old library, reachable only at low tide.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: archiveSpan,
							images: []
						}
					},
					{
						id: 't4',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'character',
							name: 'Warden Iset Nour',
							aliases: [],
							summary:
								"Keeper of the eastern gate of Port Verity, per the handout's page 2 portrait. Answers only to the Council, never the garrison commander.",
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: page2MarkerSpan,
							images: []
						}
					}
				]),
				toolCallStep([{ id: 't5', name: 'checkpoint', input: { note: 'both pages done' } }]),
				toolCallStep([{ id: 't6', name: 'job_finish', input: { outcome: 'completed' } }])
			]
		});

		const entityProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'entity'
		);
		expect(entityProposals).toHaveLength(2);
		expect(entityProposals[1]).toMatchObject({
			proposal: { kind: 'entity', payload: { name: 'Warden Iset Nour', type: 'character' } }
		});

		// the step right after the page_image call must have escalated to the multimodal
		// purpose (gateway-driver.ts): step 1 reads text (cheap), step 2 issues page_image
		// itself (still cheap - the escalation applies to the *next* step), step 3 is where
		// the model actually looks at the rendered page and proposes from it (multimodal)
		const usageEvents = events.filter((e) => e.type === 'usage');
		expect(usageEvents[0]).toMatchObject({ purpose: 'cheap' });
		expect(usageEvents[1]).toMatchObject({ purpose: 'cheap' });
		expect(usageEvents[2]).toMatchObject({ purpose: 'multimodal' });

		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({
			type: 'progress',
			status: 'finished',
			entityCount: 2,
			relationCount: 0
		});
	});
});
