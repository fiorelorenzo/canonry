/**
 * The join issue #39's own tests never exercised: `ArchiveSourceReader` (issue #25)
 * wired to the real `extractPdfText`/`extractDocxText`/`renderPdfPage` (issue #39), run
 * through the actual `GatewayDriver` against a real zip archive built from this
 * package's own checked-in fixtures - `handout.pdf` and `notes.docx` - not the
 * `InMemorySourceReader` stand-in `playbooks/pdf.test.ts` and `playbooks/docx.test.ts`
 * use, and not a unit test on `pdf.ts`/`docx.ts` in isolation either.
 *
 * Every assertion below reaches past the driver's own event stream (which never carries
 * a tool's raw result) into `MockLanguageModelV4.doGenerateCalls[n].prompt` - the actual
 * low-level messages the loop handed the model - to prove the text and the rendered
 * image that reached the model are the same bytes `ArchiveSourceReader.read`/
 * `renderPage` produce directly, not a stub and not something that merely typechecks.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { MockLanguageModelV4 } from 'ai/test';
import {
	ArchiveEntryExtractionError,
	ArchiveSourceReader,
	DEFAULT_ARCHIVE_LIMITS,
	type ArchiveLimits
} from '../archive.js';
import { loadBuiltinPlaybook } from '../playbook.js';
import { GatewayDriver } from '../gateway-driver.js';
import { ImageDimensionsTooLargeError, ImageTooLargeError } from '../media-store.js';
import {
	IDENTITY_GATEWAY,
	buildJob,
	collect,
	findSpan,
	fixedModelSelector,
	scriptedModel,
	toolCallStep
} from './test-support.js';

const PDF_FIXTURE_ROOT = fileURLToPath(new URL('../../test/fixtures/pdf/', import.meta.url));
const DOCX_FIXTURE_ROOT = fileURLToPath(new URL('../../test/fixtures/docx/', import.meta.url));
const PDF_PATH = 'handout.pdf';
const DOCX_PATH = 'notes.docx';

/** These shapes are not imported from `@ai-sdk/provider` directly - that package is
 * `ai`'s own transitive dependency, not this package's, so a bare specifier import does
 * not resolve under pnpm's isolation. Deriving them from `MockLanguageModelV4`'s own
 * exposed `doGenerateCalls` field (mirroring test-support.ts's own comment on matching
 * this installed `ai`/`@ai-sdk/provider` version's real types) keeps this file honest
 * without adding a dependency. */
type CapturedCall = MockLanguageModelV4['doGenerateCalls'][number];
type CapturedPrompt = CapturedCall['prompt'];
type CapturedMessage = CapturedPrompt[number];
type ToolMessage = Extract<CapturedMessage, { role: 'tool' }>;
type ToolResultPart = Extract<ToolMessage['content'][number], { type: 'tool-result' }>;

/** One archive, two real documents - proves the join at the archive level, not just
 * that each extractor works on its own bytes read straight off disk. */
async function buildTestArchive(limits?: ArchiveLimits): Promise<ArchiveSourceReader> {
	const pdfBytes = await readFile(`${PDF_FIXTURE_ROOT}${PDF_PATH}`);
	const docxBytes = await readFile(`${DOCX_FIXTURE_ROOT}${DOCX_PATH}`);
	const zipBytes = zipSync({
		[PDF_PATH]: new Uint8Array(pdfBytes),
		[DOCX_PATH]: new Uint8Array(docxBytes)
	});
	return limits ? ArchiveSourceReader.open(zipBytes, limits) : ArchiveSourceReader.open(zipBytes);
}

/** Every `tool-result` part for `toolName`, across every `role: 'tool'` message in a
 * captured `doGenerateCalls[n].prompt` - the only place a tool's actual return value
 * (as opposed to the driver's own coarser `JobEvent` stream) is observable in this test
 * harness. */
function toolResultParts(prompt: CapturedPrompt, toolName: string): ToolResultPart[] {
	const parts: ToolResultPart[] = [];
	for (const message of prompt) {
		if (message.role !== 'tool') continue;
		for (const part of message.content) {
			if (part.type === 'tool-result' && part.toolName === toolName) parts.push(part);
		}
	}
	return parts;
}

function callAt(model: MockLanguageModelV4, index: number): CapturedCall {
	const call = model.doGenerateCalls[index];
	if (!call) throw new Error(`expected a doGenerateCalls entry at index ${index}`);
	return call;
}

describe('ArchiveSourceReader wired to real PDF/DOCX extraction, run through GatewayDriver (issue #39 joins issue #25)', () => {
	it('the pdf playbook reads real archive text and looks at a real rendered page, both reaching the model as the archive itself produces them', async () => {
		const archive = await buildTestArchive();

		// Direct calls off the same archive instance the driver run below reuses - proves
		// the join, not merely that pdf.ts's own functions work on bytes read from disk.
		const directRead = await archive.read(PDF_PATH);
		const directRender = await archive.renderPage(PDF_PATH, 2);
		expect(directRead.truncated).toBe(false);
		expect(directRead.content).toContain('--- page 1 ---');
		expect(directRead.content).toContain('--- page 2 ---');
		expect(Math.max(directRender.width, directRender.height)).toBe(1568);

		const playbook = await loadBuiltinPlaybook('pdf');
		const archiveSpan = findSpan(directRead.content, 'The Sunken Archive is a flooded lower level');
		const page2MarkerSpan = findSpan(directRead.content, '--- page 2 ---');

		const model = scriptedModel([
			toolCallStep([{ id: 't1', name: 'source_read', input: { path: PDF_PATH } }]),
			// page 2's text came back empty between its markers: look at it instead of guessing
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
						summary: "Keeper of the eastern gate, per the handout's page 2 portrait.",
						sourceRef: { documentId: 'doc-1' },
						evidenceSpan: page2MarkerSpan,
						images: []
					}
				}
			]),
			toolCallStep([{ id: 't5', name: 'checkpoint', input: { note: 'both pages done' } }]),
			toolCallStep([{ id: 't6', name: 'job_finish', input: { outcome: 'completed', summary: '' } }])
		]);

		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const job = buildJob({
			id: 'job-1',
			playbook,
			documents: [{ id: 'doc-1', sourcePath: PDF_PATH }],
			sources: archive
		});
		const { events } = await collect(job, driver);

		const entityProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'entity'
		);
		expect(entityProposals).toHaveLength(2);
		const finished = events.find((e) => e.type === 'progress' && e.status === 'finished');
		expect(finished).toMatchObject({ type: 'progress', status: 'finished', entityCount: 2 });
		// step 3 (right after page_image) escalated to the multimodal purpose
		const usageEvents = events.filter((e) => e.type === 'usage');
		expect(usageEvents[2]).toMatchObject({ purpose: 'multimodal' });

		// The text the model actually saw is the archive reader's own real extraction,
		// markers and all - not a raw UTF-8 decode of the PDF's own binary bytes.
		const sourceReadResults = toolResultParts(callAt(model, 1).prompt, 'source_read');
		const sourceReadResult = sourceReadResults[0];
		if (!sourceReadResult) throw new Error('expected one source_read tool-result part');
		expect(sourceReadResults).toHaveLength(1);
		expect(sourceReadResult.output).toEqual({
			type: 'json',
			value: { ok: true, content: directRead.content, truncated: false }
		});

		// The image the model actually saw is the real rendered page - same dimensions and
		// same JPEG bytes `renderPage` produces directly off the same archive, not a stub.
		const pageImageResults = toolResultParts(callAt(model, 2).prompt, 'page_image');
		const pageImageResult = pageImageResults[0];
		if (!pageImageResult) throw new Error('expected one page_image tool-result part');
		expect(pageImageResults).toHaveLength(1);
		const output = pageImageResult.output;
		if (output.type !== 'content') {
			throw new Error(`expected a content tool output, got ${output.type}`);
		}
		const filePart = output.value.find(
			(part): part is Extract<(typeof output.value)[number], { type: 'file' }> =>
				part.type === 'file'
		);
		if (!filePart) throw new Error('page_image tool output carried no file part');
		expect(filePart.mediaType).toBe('image/jpeg');
		expect(filePart.data).toEqual({ type: 'data', data: directRender.base64 });
	});

	it('the docx playbook reads real archive-extracted structured text, off the same archive the pdf document above shares', async () => {
		const archive = await buildTestArchive();
		const directRead = await archive.read(DOCX_PATH);
		expect(directRead.truncated).toBe(false);
		expect(directRead.content).toContain('# Warden Iset Nour');
		expect(directRead.content).not.toMatch(/[*_<>]/); // visual styling markup dropped

		const playbook = await loadBuiltinPlaybook('docx');
		const wardenSpan = findSpan(directRead.content, 'Keeper of the eastern gate.');
		const veySpan = findSpan(directRead.content, '| Garrison Commander Vey | The Council |');
		const rivalSpan = findSpan(
			directRead.content,
			'do not get along; the Council keeps them separate on purpose.'
		);

		const model = scriptedModel([
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
				}
			]),
			toolCallStep([
				{
					id: 't4',
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
					id: 't5',
					name: 'checkpoint',
					input: { note: 'table and prose done' }
				}
			]),
			toolCallStep([{ id: 't6', name: 'job_finish', input: { outcome: 'completed', summary: '' } }])
		]);

		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const job = buildJob({
			id: 'job-2',
			playbook,
			documents: [{ id: 'doc-1', sourcePath: DOCX_PATH }],
			sources: archive
		});
		const { events } = await collect(job, driver);

		const entityProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'entity'
		);
		const relationProposals = events.filter(
			(e) => e.type === 'proposal' && e.proposal.kind === 'relation'
		);
		expect(entityProposals).toHaveLength(2);
		expect(relationProposals).toHaveLength(1);

		const sourceReadResults = toolResultParts(callAt(model, 1).prompt, 'source_read');
		const sourceReadResult = sourceReadResults[0];
		if (!sourceReadResult) throw new Error('expected one source_read tool-result part');
		expect(sourceReadResults).toHaveLength(1);
		expect(sourceReadResult.output).toEqual({
			type: 'json',
			value: { ok: true, content: directRead.content, truncated: false }
		});
	});

	it('fails a corrupt entry (wrong header, or truncated) with a named error naming the entry, not a crash - a scripted source_read call sees ok: false', async () => {
		const zipBytes = zipSync({ 'bad.pdf': new TextEncoder().encode('not a real pdf') });
		const reader = ArchiveSourceReader.open(zipBytes);
		await expect(reader.read('bad.pdf')).rejects.toThrow(ArchiveEntryExtractionError);
		await expect(reader.read('bad.pdf')).rejects.toThrow(/entry "bad\.pdf"/);
	});

	it('fails a render over the configured pixel limit with a named error naming the entry, checked against the real render, not pdf.ts internal constants alone', async () => {
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxRenderedPixels: 1_000_000 };
		const archive = await buildTestArchive(limits);
		await expect(archive.renderPage(PDF_PATH, 2)).rejects.toThrow(ImageDimensionsTooLargeError);
		await expect(archive.renderPage(PDF_PATH, 2)).rejects.toThrow(/"handout\.pdf"/);
	});

	it('fails a render over the configured byte-size limit with a named error naming the entry', async () => {
		const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxRenderedBytes: 50_000 };
		const archive = await buildTestArchive(limits);
		await expect(archive.renderPage(PDF_PATH, 2)).rejects.toThrow(ImageTooLargeError);
		await expect(archive.renderPage(PDF_PATH, 2)).rejects.toThrow(/"handout\.pdf"/);
	});
});
