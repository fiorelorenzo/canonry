import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { loadFixtureSourceReader } from './fixture-source.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

const EXPORT_ROOT = fileURLToPath(
	new URL('../../test/fixtures/world-anvil/export/', import.meta.url)
);
const VALE_JSON = 'json/duskwood-vale.json';
const VALE_HTML = 'html/duskwood-vale.html';
const BARON_JSON = 'json/baron-corvain.json';
const BARON_HTML = 'html/baron-corvain.html';

describe('world anvil playbook (issue #43, SPEC.md §6.8)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('world-anvil');
		expect(playbook.id).toBe('world-anvil');
		expect(playbook.systemPrompt).toContain('free-tier World Anvil user');
	});

	it('maps the article template to an entity type and an inter-article link to a relation', async () => {
		const playbook = await loadBuiltinPlaybook('world-anvil');
		const sources = await loadFixtureSourceReader(EXPORT_ROOT);
		const valeHtml = await sources.read(VALE_HTML);
		const baronHtml = await sources.read(BARON_HTML);

		const govSpan = findSpan(valeHtml.content, 'Baron Corvain</a>, though the');

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: VALE_JSON },
			sources,
			steps: [
				toolCallStep([
					{ id: 't1', name: 'source_read', input: { path: VALE_JSON } },
					{ id: 't2', name: 'source_read', input: { path: VALE_HTML } }
				]),
				toolCallStep([
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'place',
							name: 'Duskwood Vale',
							aliases: [],
							summary: 'A forested vale on the western border, prone to fog and smuggling trails.',
							sourceRef: { documentId: 'doc-1', path: VALE_JSON },
							evidenceSpan: { start: 0, end: 40 },
							images: []
						}
					}
				]),
				// follow the inter-article link to Baron Corvain's own json+html pair
				toolCallStep([
					{ id: 't4', name: 'source_read', input: { path: BARON_JSON } },
					{ id: 't5', name: 'source_read', input: { path: BARON_HTML } }
				]),
				toolCallStep([
					{
						id: 't6',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'character',
							name: 'Baron Corvain',
							aliases: [],
							summary: 'Steward of Duskwood Vale by title, smuggler by trade.',
							sourceRef: { documentId: 'doc-1', path: BARON_JSON },
							evidenceSpan: { start: 0, end: 30 },
							images: []
						}
					}
				]),
				toolCallStep([
					{
						id: 't7',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e2',
							label: 'ruled by',
							inverseLabel: 'rules',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1', path: VALE_HTML },
							evidenceSpan: govSpan
						}
					}
				]),
				toolCallStep([
					{
						id: 't8',
						name: 'checkpoint',
						input: { note: 'article and its link done' }
					}
				]),
				toolCallStep([{ id: 't9', name: 'job_finish', input: { outcome: 'completed' } }])
			]
		});

		const entityProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'entity'
		);
		const relationProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'relation'
		);
		expect(entityProposals).toHaveLength(2);
		expect(relationProposals).toHaveLength(1);

		expect(entityProposals[0]).toMatchObject({
			proposal: { kind: 'entity', payload: { type: 'place', name: 'Duskwood Vale' } }
		});
		expect(entityProposals[1]).toMatchObject({
			proposal: { kind: 'entity', payload: { type: 'character', name: 'Baron Corvain' } }
		});
		expect(relationProposals[0]).toMatchObject({
			proposal: {
				kind: 'relation',
				payload: { fromLocalId: 'e1', toLocalId: 'e2', label: 'ruled by', inverseLabel: 'rules' }
			}
		});

		expect(baronHtml.content).toContain('Duskwood Vale');

		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({
			type: 'progress',
			status: 'finished',
			entityCount: 2,
			relationCount: 1
		});
	});
});
