import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { loadFixtureSourceReader } from './fixture-source.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

const VAULT_ROOT = fileURLToPath(new URL('../../test/fixtures/obsidian/vault/', import.meta.url));
const ALDRIC_PATH = 'Characters/Aldric Voss.md';

describe('obsidian playbook (issue #41, SPEC.md §6.6)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('obsidian');
		expect(playbook.id).toBe('obsidian');
		expect(playbook.tools).toContain('relation_propose');
		expect(playbook.tools).toContain('image_store');
	});

	it('turns wikilinks, a Dataview field and an image embed into proposals over the fixture vault', async () => {
		const playbook = await loadBuiltinPlaybook('obsidian');
		const sources = await loadFixtureSourceReader(VAULT_ROOT);
		const aldric = await sources.read(ALDRIC_PATH);

		const portraitSpan = findSpan(aldric.content, '![[aldric-portrait.png]]');
		const portVeritySpan = findSpan(
			aldric.content,
			'commands the harbour watch in [[Port Verity]]'
		);
		const factionFieldSpan = findSpan(aldric.content, 'Faction:: [[Silver Hand]]');
		const reportsFieldSpan = findSpan(aldric.content, 'Reports to:: [[Mira Sable#Council Seat]]');

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: ALDRIC_PATH },
			sources,
			steps: [
				// 1. read the primary note
				toolCallStep([{ id: 't1', name: 'source_read', input: { path: ALDRIC_PATH } }]),
				// 2. store the embedded portrait before referencing it
				toolCallStep([
					{ id: 't2', name: 'image_store', input: { path: 'images/aldric-portrait.png' } }
				]),
				// 3. propose Aldric himself, aliases from frontmatter, image attached
				toolCallStep([
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'character',
							name: 'Aldric Voss',
							aliases: ['the Grey Captain', 'Captain Voss'],
							summary: 'Commands the harbour watch in Port Verity, rank Captain.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: portraitSpan,
							images: ['asset-1']
						}
					}
				]),
				// 4. follow every wikilink target: read each linked note for context
				toolCallStep([
					{ id: 't4', name: 'source_read', input: { path: 'Locations/Port Verity.md' } },
					{ id: 't5', name: 'source_read', input: { path: 'Factions/Silver Hand.md' } },
					{ id: 't6', name: 'source_read', input: { path: 'Characters/Mira Sable.md' } }
				]),
				// 5. propose a minimal entity for each linked target
				toolCallStep([
					{
						id: 't7',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'place',
							name: 'Port Verity',
							aliases: [],
							summary: 'A tidal port city.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: { start: 0, end: 20 },
							images: []
						}
					},
					{
						id: 't8',
						name: 'entity_propose',
						input: {
							localId: 'e3',
							type: 'faction',
							name: 'Silver Hand',
							aliases: ['the Hand'],
							summary: "A merchants' guild that funds harbour security.",
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: { start: 0, end: 20 },
							images: []
						}
					},
					{
						id: 't9',
						name: 'entity_propose',
						input: {
							localId: 'e4',
							type: 'character',
							name: 'Mira Sable',
							aliases: [],
							summary: 'Holds a seat on the Silver Hand council.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: { start: 0, end: 20 },
							images: []
						}
					}
				]),
				// 6. one relation per distinct target - the prose mention and the Dataview
				//    field for Silver Hand collapse into one relation, same for Mira Sable
				toolCallStep([
					{
						id: 't10',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e2',
							label: 'based in',
							inverseLabel: 'hosts',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: portVeritySpan
						}
					},
					{
						id: 't11',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e3',
							label: 'member of',
							inverseLabel: 'has member',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: factionFieldSpan
						}
					},
					{
						id: 't12',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e4',
							label: 'reports to',
							inverseLabel: 'commands',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: reportsFieldSpan
						}
					}
				]),
				toolCallStep([
					{
						id: 't13',
						name: 'checkpoint',
						input: { note: 'linked notes done' }
					}
				]),
				toolCallStep([
					{ id: 't14', name: 'job_finish', input: { outcome: 'completed', summary: '' } }
				])
			]
		});

		const entityProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'entity'
		);
		const relationProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'relation'
		);
		expect(entityProposals).toHaveLength(4);
		expect(relationProposals).toHaveLength(3);

		const aldricProposal = entityProposals.find(
			(e) =>
				e.type === 'proposal' && e.proposal.kind === 'entity' && e.proposal.payload.localId === 'e1'
		);
		expect(aldricProposal).toMatchObject({
			proposal: { kind: 'entity', payload: { name: 'Aldric Voss', images: ['asset-1'] } }
		});

		const relationLabels = relationProposals
			.map((e) =>
				e.type === 'proposal' && e.proposal.kind === 'relation' ? e.proposal.payload.label : null
			)
			.sort();
		expect(relationLabels).toEqual(['based in', 'member of', 'reports to']);

		const factionRelation = relationProposals.find(
			(e) =>
				e.type === 'proposal' &&
				e.proposal.kind === 'relation' &&
				e.proposal.payload.toLocalId === 'e3'
		);
		expect(factionRelation).toMatchObject({
			proposal: {
				kind: 'relation',
				payload: { fromLocalId: 'e1', label: 'member of', inverseLabel: 'has member' }
			}
		});

		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({
			type: 'progress',
			status: 'finished',
			entityCount: 4,
			relationCount: 3
		});
	});
});
