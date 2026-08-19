import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { loadFixtureSourceReader } from './fixture-source.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

const EXPORT_ROOT = fileURLToPath(new URL('../../test/fixtures/kanka/export/', import.meta.url));
const CHARACTERS_PATH = 'characters.json';

describe('kanka playbook (issue #38, SPEC.md §6.9)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('kanka');
		expect(playbook.id).toBe('kanka');
		expect(playbook.tools).toContain('image_store');
	});

	it('maps Kanka entity types onto ours, resolves relations.target_id across files, and attaches an image', async () => {
		const playbook = await loadBuiltinPlaybook('kanka');
		const sources = await loadFixtureSourceReader(EXPORT_ROOT);
		const characters = await sources.read(CHARACTERS_PATH);
		const locations = await sources.read('locations.json');
		const organisations = await sources.read('organisations.json');

		const elenyaSpan = findSpan(characters.content, 'Elenya Duskwalker');
		const corvainSpan = findSpan(characters.content, 'Baron Corvain');
		const protectsSpan = findSpan(characters.content, '"relation": "Protects"');
		const leadsSpan = findSpan(characters.content, '"relation": "Leads"');
		const rivalSpan = findSpan(characters.content, '"relation": "Rival"');
		const valeSpan = findSpan(locations.content, 'Duskwood Vale');
		const compactSpan = findSpan(organisations.content, 'The Ashen Compact');

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: CHARACTERS_PATH },
			sources,
			steps: [
				toolCallStep([{ id: 't1', name: 'source_read', input: { path: CHARACTERS_PATH } }]),
				toolCallStep([{ id: 't2', name: 'image_store', input: { path: 'images/elenya.png' } }]),
				toolCallStep([
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'character',
							name: 'Elenya Duskwalker',
							aliases: [],
							summary: 'A ranger who has patrolled Duskwood Vale for a decade.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: elenyaSpan,
							images: ['asset-1']
						}
					},
					{
						id: 't4',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'character',
							name: 'Baron Corvain',
							aliases: [],
							summary: 'A corrupt noble who bankrolls a smuggling ring.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: corvainSpan,
							images: []
						}
					}
				]),
				// resolve relations.target_id 5201 and 5301, which live in other type files
				toolCallStep([
					{ id: 't5', name: 'source_list', input: { path: '' } },
					{ id: 't6', name: 'source_read', input: { path: 'locations.json' } },
					{ id: 't7', name: 'source_read', input: { path: 'organisations.json' } }
				]),
				toolCallStep([
					{
						id: 't8',
						name: 'entity_propose',
						input: {
							localId: 'e3',
							type: 'place',
							name: 'Duskwood Vale',
							aliases: [],
							summary: 'A forested vale on the western border.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: valeSpan,
							images: []
						}
					},
					{
						id: 't9',
						name: 'entity_propose',
						input: {
							localId: 'e4',
							type: 'faction',
							name: 'The Ashen Compact',
							aliases: [],
							summary: 'A smuggling ring fronted by respectable names.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: compactSpan,
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
							label: 'protects',
							inverseLabel: 'protected by',
							cardinality: 'one_to_many',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: protectsSpan
						}
					},
					{
						id: 't11',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e2',
							toLocalId: 'e4',
							label: 'leads',
							inverseLabel: 'led by',
							cardinality: 'one_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: leadsSpan
						}
					},
					{
						id: 't12',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e2',
							toLocalId: 'e1',
							label: 'rival',
							inverseLabel: 'rival',
							cardinality: 'one_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: rivalSpan
						}
					}
				]),
				toolCallStep([
					{
						id: 't13',
						name: 'checkpoint',
						input: { note: 'both characters and their relations done' }
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

		const types = entityProposals
			.map((e) =>
				e.type === 'proposal' && e.proposal.kind === 'entity' ? e.proposal.payload.type : null
			)
			.sort();
		expect(types).toEqual(['character', 'character', 'faction', 'place']);

		const elenyaProposal = entityProposals.find(
			(e) =>
				e.type === 'proposal' && e.proposal.kind === 'entity' && e.proposal.payload.localId === 'e1'
		);
		expect(elenyaProposal).toMatchObject({
			proposal: { kind: 'entity', payload: { name: 'Elenya Duskwalker', images: ['asset-1'] } }
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
