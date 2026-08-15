import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { loadFixtureSourceReader } from './fixture-source.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

/**
 * `export/` (checked in, issue #45) is a small, real folder tree of individually
 * exported OneNote pages, laid out exactly the way `meichthys/onenote-html-export`
 * (MIT-licensed PowerShell built on OneNote's own `GetHierarchy`/`Publish` COM calls)
 * documents its own output: `notebook/section/page.htm`, a subpage living in a folder
 * named after its parent page, and a sibling `<page>_files/` folder for embedded
 * attachments. `stacks-sketch.png` and `archive-map.png` are real PNGs (generated with
 * Pillow, not stub bytes) so `image_store` reads real image bytes off disk, exactly as
 * `obsidian.test.ts`/`kanka.test.ts` do for their own fixture images.
 *
 * `Flooded Stacks.htm` is a subpage of `The Sunken Archive.htm` (it lives in
 * `The Sunken Archive/`, a folder named after its parent, not `The Sunken
 * Archive_files/`, the sibling that holds the parent's own attachment) - the one
 * signal `onenote.md` reads that no other shipped playbook can: a subpage's folder
 * nesting, not its prose, implies the parent relation.
 */
const EXPORT_ROOT = fileURLToPath(new URL('../../test/fixtures/onenote/export/', import.meta.url));
const FLOODED_STACKS_PATH = 'Ashenport Campaign/Handouts/The Sunken Archive/Flooded Stacks.htm';
const ARCHIVE_PATH = 'Ashenport Campaign/Handouts/The Sunken Archive.htm';
const WARDEN_PATH = 'Ashenport Campaign/Handouts/Warden Iset Nour.htm';
const STACKS_IMAGE_PATH =
	'Ashenport Campaign/Handouts/The Sunken Archive/Flooded Stacks_files/stacks-sketch.png';

describe('onenote playbook (issue #45, SPEC.md §6.6, §6.10)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('onenote');
		expect(playbook.id).toBe('onenote');
		expect(playbook.tools).toContain('source_list');
		expect(playbook.tools).toContain('image_store');
		expect(playbook.tools).toContain('relation_propose');
		expect(playbook.tools).not.toContain('page_image'); // an exported page is never a scanned page
		expect(playbook.systemPrompt).toContain('.onepkg');
	});

	it('proposes a subpage-of relation from the export tree, an entity per page, and an in-body link relation', async () => {
		const playbook = await loadBuiltinPlaybook('onenote');
		const sources = await loadFixtureSourceReader(EXPORT_ROOT);
		const stacks = await sources.read(FLOODED_STACKS_PATH);
		const archive = await sources.read(ARCHIVE_PATH);
		const warden = await sources.read(WARDEN_PATH);

		const stacksEntitySpan = findSpan(
			stacks.content,
			'Careful readers wade in at low tide to pull waterlogged ledgers before they'
		);
		const stacksTitleSpan = findSpan(stacks.content, '<title>Flooded Stacks</title>');
		const wardenLinkSpan = findSpan(
			stacks.content,
			'Watched over by <a href="../Warden Iset Nour.htm">Warden Iset Nour</a>'
		);
		const archiveSpan = findSpan(
			archive.content,
			'A flooded lower level of the old library, accessible only at low tide.'
		);
		const wardenSpan = findSpan(
			warden.content,
			'Keeper of the eastern gate, and the only person the Council trusts with a key to the'
		);

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: FLOODED_STACKS_PATH },
			sources,
			steps: [
				// 1. read the bound page
				toolCallStep([{ id: 't1', name: 'source_read', input: { path: FLOODED_STACKS_PATH } }]),
				// 2. store the embedded sketch before referencing it
				toolCallStep([{ id: 't2', name: 'image_store', input: { path: STACKS_IMAGE_PATH } }]),
				// 3. propose the page's own entity, image attached
				toolCallStep([
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'place',
							name: 'Flooded Stacks',
							aliases: [],
							summary:
								'The lower archive floods every spring tide; the lowest shelves stay permanently underwater.',
							sourceRef: { documentId: 'doc-1', path: FLOODED_STACKS_PATH },
							evidenceSpan: stacksEntitySpan,
							images: ['asset-1']
						}
					}
				]),
				// 4. list this page's own section to find its parent among the siblings,
				//    distinguishing "The Sunken Archive.htm" from "The Sunken Archive_files/"
				toolCallStep([
					{ id: 't4', name: 'source_list', input: { path: 'Ashenport Campaign/Handouts' } }
				]),
				// 5. read the parent page found by the folder-tree rule
				toolCallStep([{ id: 't5', name: 'source_read', input: { path: ARCHIVE_PATH } }]),
				// 6. propose a minimal entity for the parent
				toolCallStep([
					{
						id: 't6',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'place',
							name: 'The Sunken Archive',
							aliases: [],
							summary: 'A flooded lower level of the old library, accessible only at low tide.',
							sourceRef: { documentId: 'doc-1', path: ARCHIVE_PATH },
							evidenceSpan: archiveSpan,
							images: []
						}
					}
				]),
				// 7. the subpage-of relation the folder tree itself implies
				toolCallStep([
					{
						id: 't7',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e2',
							label: 'subpage of',
							inverseLabel: 'has subpage',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1', path: FLOODED_STACKS_PATH },
							evidenceSpan: stacksTitleSpan
						}
					}
				]),
				// 8. follow the in-body link to the warden's own page
				toolCallStep([{ id: 't8', name: 'source_read', input: { path: WARDEN_PATH } }]),
				toolCallStep([
					{
						id: 't9',
						name: 'entity_propose',
						input: {
							localId: 'e3',
							type: 'character',
							name: 'Warden Iset Nour',
							aliases: [],
							summary: 'Keeper of the eastern gate. Answers only to the Council.',
							sourceRef: { documentId: 'doc-1', path: WARDEN_PATH },
							evidenceSpan: wardenSpan,
							images: []
						}
					}
				]),
				toolCallStep([
					{
						id: 't10',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e3',
							label: 'watched over by',
							inverseLabel: 'watches over',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1', path: FLOODED_STACKS_PATH },
							evidenceSpan: wardenLinkSpan
						}
					}
				]),
				toolCallStep([
					{
						id: 't11',
						name: 'checkpoint',
						input: { note: 'parent and linked page resolved' }
					}
				]),
				toolCallStep([{ id: 't12', name: 'job_finish', input: { outcome: 'completed' } }])
			]
		});

		const entityProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'entity'
		);
		const relationProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'relation'
		);
		expect(entityProposals).toHaveLength(3);
		expect(relationProposals).toHaveLength(2);

		const stacksProposal = entityProposals.find(
			(e) =>
				e.type === 'proposal' && e.proposal.kind === 'entity' && e.proposal.payload.localId === 'e1'
		);
		expect(stacksProposal).toMatchObject({
			proposal: {
				kind: 'entity',
				payload: { type: 'place', name: 'Flooded Stacks', images: ['asset-1'] }
			}
		});

		// The parent relation the subpage folder implies - the value this playbook adds
		// over generic.md, since no prose in Flooded Stacks.htm ever states it.
		const subpageRelation = relationProposals.find(
			(e) =>
				e.type === 'proposal' &&
				e.proposal.kind === 'relation' &&
				e.proposal.payload.label === 'subpage of'
		);
		expect(subpageRelation).toMatchObject({
			proposal: {
				kind: 'relation',
				payload: {
					fromLocalId: 'e1',
					toLocalId: 'e2',
					label: 'subpage of',
					inverseLabel: 'has subpage',
					cardinality: 'many_to_one'
				}
			}
		});
		const parentProposal = entityProposals.find(
			(e) =>
				e.type === 'proposal' && e.proposal.kind === 'entity' && e.proposal.payload.localId === 'e2'
		);
		expect(parentProposal).toMatchObject({
			proposal: { kind: 'entity', payload: { type: 'place', name: 'The Sunken Archive' } }
		});

		const linkRelation = relationProposals.find(
			(e) =>
				e.type === 'proposal' &&
				e.proposal.kind === 'relation' &&
				e.proposal.payload.label === 'watched over by'
		);
		expect(linkRelation).toMatchObject({
			proposal: { kind: 'relation', payload: { fromLocalId: 'e1', toLocalId: 'e3' } }
		});
		const wardenProposal = entityProposals.find(
			(e) =>
				e.type === 'proposal' && e.proposal.kind === 'entity' && e.proposal.payload.localId === 'e3'
		);
		expect(wardenProposal).toMatchObject({
			proposal: { kind: 'entity', payload: { type: 'character', name: 'Warden Iset Nour' } }
		});

		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({
			type: 'progress',
			documentId: 'doc-1',
			status: 'finished',
			entityCount: 3,
			relationCount: 2
		});
	});
});
