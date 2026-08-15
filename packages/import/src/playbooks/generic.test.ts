import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { loadFixtureSourceReader } from './fixture-source.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

const EXPORT_ROOT = fileURLToPath(new URL('../../test/fixtures/generic/export/', import.meta.url));
const NOTES_PATH = 'campaign-notes.txt';

describe('generic playbook (issue #44, SPEC.md §6.6)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('generic');
		expect(playbook.id).toBe('generic');
	});

	it('still produces usable proposals from a source with no dedicated playbook', async () => {
		const playbook = await loadBuiltinPlaybook('generic');
		const sources = await loadFixtureSourceReader(EXPORT_ROOT);
		const notes = await sources.read(NOTES_PATH);

		const seraSpan = findSpan(notes.content, 'Sera Bellweather runs the Ashgate trading post');
		const torvinSpan = findSpan(notes.content, 'delivers supplies to Sera every fortnight');

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: NOTES_PATH },
			sources,
			steps: [
				toolCallStep([{ id: 't1', name: 'source_read', input: { path: NOTES_PATH } }]),
				toolCallStep([
					{
						id: 't2',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'character',
							name: 'Sera Bellweather',
							aliases: [],
							summary: 'Runs the Ashgate trading post and keeps the peace herself.',
							sourceRef: { documentId: 'doc-1', path: NOTES_PATH },
							evidenceSpan: seraSpan,
							images: []
						}
					},
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'character',
							name: 'Torvin Hale',
							aliases: [],
							summary: 'Delivers supplies to Sera every fortnight and owes her money.',
							sourceRef: { documentId: 'doc-1', path: NOTES_PATH },
							evidenceSpan: torvinSpan,
							images: []
						}
					}
				]),
				toolCallStep([
					{
						id: 't4',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e2',
							toLocalId: 'e1',
							label: 'supplies',
							inverseLabel: 'supplied by',
							cardinality: 'one_to_one',
							sourceRef: { documentId: 'doc-1', path: NOTES_PATH },
							evidenceSpan: torvinSpan
						}
					}
				]),
				toolCallStep([{ id: 't5', name: 'checkpoint', input: { note: 'both npcs done' } }]),
				toolCallStep([{ id: 't6', name: 'job_finish', input: { outcome: 'completed' } }])
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

		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({
			type: 'progress',
			status: 'finished',
			entityCount: 2,
			relationCount: 1
		});
	});
});
