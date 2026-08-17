import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBuiltinPlaybook } from '../playbook.js';
import { InMemorySourceReader } from '../sources.js';
import { findSpan, runScriptedDocument, toolCallStep } from './test-support.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../../test/fixtures/docx/', import.meta.url));
const DOCX_PATH = 'notes.docx';

/**
 * `notes.docx` (checked in, issue #46) is a real DOCX built with pandoc, with a heading,
 * a bullet list and a table, so it actually exercises "structure kept" (SPEC.md §6.6).
 * There is no real DOCX text extractor wired up yet (issue #39 is unclaimed), so this
 * test supplies the structured text directly rather than pretending one ran:
 * `notes.expected-text.txt` is pandoc's own markdown extraction of this exact docx
 * (`pandoc notes.docx -t markdown+pipe_tables`), matching docx.md's documented
 * `#`-heading / `-`-list / `|`-table convention, not hand-typed.
 */
async function buildDocxSourceReader(): Promise<InMemorySourceReader> {
	const text = await readFile(`${FIXTURE_ROOT}notes.expected-text.txt`, 'utf8');
	return new InMemorySourceReader({ files: { [DOCX_PATH]: text } });
}

describe('docx playbook (issue #39, SPEC.md §6.6)', () => {
	it('loads through the real playbook loader', async () => {
		const playbook = await loadBuiltinPlaybook('docx');
		expect(playbook.id).toBe('docx');
		expect(playbook.tools).not.toContain('page_image'); // docx is never a scanned page
	});

	it('proposes an entity per heading section and a relation from the table and prose', async () => {
		const playbook = await loadBuiltinPlaybook('docx');
		const sources = await buildDocxSourceReader();
		const { content: text } = await sources.read(DOCX_PATH);

		const wardenSpan = findSpan(text, 'Keeper of the eastern gate.');
		const veySpan = findSpan(text, '| Garrison Commander Vey | The Council |');
		const rivalSpan = findSpan(
			text,
			'do not get along; the Council keeps them separate on purpose.'
		);

		const { events } = await runScriptedDocument({
			playbook,
			document: { id: 'doc-1', sourcePath: DOCX_PATH },
			sources,
			steps: [
				toolCallStep([{ id: 't1', name: 'source_read', input: { path: DOCX_PATH } }]),
				toolCallStep([
					{
						id: 't2',
						name: 'entity_propose',
						input: {
							localId: 'e1',
							type: 'character',
							name: 'Warden Iset Nour',
							aliases: [],
							summary: 'Keeper of the eastern gate. Answers only to the Council.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: wardenSpan,
							images: []
						}
					},
					{
						id: 't3',
						name: 'entity_propose',
						input: {
							localId: 'e2',
							type: 'character',
							name: 'Garrison Commander Vey',
							aliases: [],
							summary: 'Reports to the Council, per the chain of command table.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: veySpan,
							images: []
						}
					},
					{
						id: 't4',
						name: 'entity_propose',
						input: {
							localId: 'e3',
							type: 'faction',
							name: 'The Council',
							aliases: [],
							summary: 'The authority both the warden and the garrison commander answer to.',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: veySpan,
							images: []
						}
					}
				]),
				toolCallStep([
					{
						id: 't5',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e3',
							label: 'reports to',
							inverseLabel: 'commands',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: veySpan
						}
					},
					{
						id: 't6',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e2',
							toLocalId: 'e3',
							label: 'reports to',
							inverseLabel: 'commands',
							cardinality: 'many_to_one',
							sourceRef: { documentId: 'doc-1' },
							evidenceSpan: veySpan
						}
					},
					{
						id: 't7',
						name: 'relation_propose',
						input: {
							fromLocalId: 'e1',
							toLocalId: 'e2',
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
						id: 't8',
						name: 'checkpoint',
						input: { note: 'table and prose done' }
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
		expect(entityProposals).toHaveLength(3);
		expect(relationProposals).toHaveLength(3);

		const rivalRelation = relationProposals.find(
			(e) =>
				e.type === 'proposal' &&
				e.proposal.kind === 'relation' &&
				e.proposal.payload.label === 'rival'
		);
		expect(rivalRelation).toMatchObject({
			proposal: { kind: 'relation', payload: { fromLocalId: 'e1', toLocalId: 'e2' } }
		});

		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({
			type: 'progress',
			status: 'finished',
			entityCount: 3,
			relationCount: 3
		});
	});
});
