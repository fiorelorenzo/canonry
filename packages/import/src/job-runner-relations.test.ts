/**
 * Issue #613, end to end: a first import of a page hierarchy, where both ends of every
 * parent/subpage relation are entries the same job is only proposing.
 *
 * **Why this file exists as well as `packages/db/test/relation-endpoint-proposals.test.ts`.**
 * That one owns the four transitions of the endpoint pointer at the layer that writes them.
 * This one owns the question the issue was actually filed about: does the merge engine still
 * throw the relation away. Measured on a real notebook, it threw away 203 of 203, so the
 * defended property here is that a document proposing two new entries and the link between
 * them produces a `relation` proposal at all, and that the GM can then accept it.
 *
 * Every case fails on the commit before this issue: `materializeDocumentProposals` dropped a
 * relation whose endpoint was not already a real entity, counted it, and moved on.
 *
 * **What is real and what is scripted.** The driver is the real `GatewayDriver` against a
 * `MockLanguageModelV4` scripting the tool calls a model makes, exactly the substitution
 * `job-runner-guards.test.ts` makes and for the same reason: this is a test of the engine's
 * decision given an extraction, not of the extraction. The playbook, the tool surface, the
 * merge engine, the plan writer and Postgres are all real. `part of` is the shipped
 * catalogue's own label and admits place -> place, so `resolveRelationType` returns
 * `existing` on rung 1 and no vocabulary question stands between the relation and the queue,
 * which keeps every assertion below about this issue rather than about decision K1.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import {
	acceptProposal,
	closeDb,
	eq,
	rejectProposal,
	RelationEndpointNotAcceptedError,
	RELATION_ENDPOINT_REJECTED,
	type Db
} from '@canonry/db';
import {
	operationPrice,
	proposal as proposalTable,
	proposalPlan,
	relation,
	universe,
	user
} from '@canonry/db/schema';
import { openTestDb, TEST_CONCURRENCY_LIMIT } from './test-db.js';
import {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector
} from './gateway-driver.js';
import { loadBuiltinPlaybook } from './playbook.js';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import { admitAndCreateImportJob, ImportJobRunner } from './job-runner.js';
import { MATCH_THRESHOLDS, normalizeForMatching } from './matching.js';
import type { SimilarityFn } from './matching.js';
import type { Embedder } from '@canonry/copilot';

const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;
const TEST_PARAMS = { pricePerInputMTok: 1, pricePerOutputMTok: 2, creditsPerEur: 100 };

/** Zero vectors, so `resolveRelationType`'s semantic rung never fires and every case here
 * turns on rung 1's exact catalogue match, which is the deterministic one. */
const stubEmbedRelationLabel: Embedder = async (texts) => texts.map(() => [0, 0, 0]);

/** Same-name is the same entity, nothing else is. Enough for the cross-document fold case
 * and nothing more, which keeps the matcher out of the way of what is being tested. */
const sameName: SimilarityFn = (subject, candidate) =>
	normalizeForMatching(subject.name) === normalizeForMatching(candidate.name) ? 1 : 0;

function usage(inputTotal: number, outputTotal: number) {
	return {
		inputTokens: {
			total: inputTotal,
			noCache: inputTotal,
			cacheRead: undefined,
			cacheWrite: undefined
		},
		outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined }
	};
}

function toolCallStep(calls: Array<{ id: string; name: string; input: unknown }>) {
	return {
		content: calls.map((call) => ({
			type: 'tool-call' as const,
			toolCallId: call.id,
			toolName: call.name,
			input: JSON.stringify(call.input)
		})),
		finishReason: { unified: 'tool-calls' as const, raw: undefined },
		usage: usage(10, 5),
		warnings: []
	};
}

/** `proposal.patch` and `proposal.evidence` are jsonb, so the compiler knows nothing about
 * them. Narrowed rather than asserted: an assertion here would pass whatever the column
 * actually held straight into an assertion message and read as a shape mismatch. */
function stringField(value: unknown, key: string): string | null {
	if (typeof value !== 'object' || value === null || !(key in value)) return null;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === 'string' ? field : null;
}

function objectField(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null || !(key in value)) return null;
	return (value as Record<string, unknown>)[key];
}

function fixedModelSelector(languageModel: LanguageModel): ModelSelector {
	const resolved: ImportModel = {
		languageModel,
		provider: 'test',
		modelId: 'test-cheap',
		params: TEST_PARAMS
	};
	return { resolve: async () => resolved };
}

interface Page {
	id: string;
	sourcePath: string;
	text: string;
}

interface Entity {
	localId: string;
	type: string;
	name: string;
	summary: string;
	span: { start: number; end: number };
}

interface Link {
	fromLocalId: string;
	toLocalId: string;
	span: { start: number; end: number };
}

interface Script {
	page: Page;
	entities: Entity[];
	links: Link[];
}

function stepsFor(scripts: Script[]) {
	return scripts.flatMap((script) => [
		toolCallStep([
			{ id: `read-${script.page.id}`, name: 'source_read', input: { path: script.page.sourcePath } }
		]),
		...script.entities.map((e) =>
			toolCallStep([
				{
					id: `entity-${script.page.id}-${e.localId}`,
					name: 'entity_propose',
					input: {
						localId: e.localId,
						type: e.type,
						name: e.name,
						aliases: [],
						summary: e.summary,
						sourceRef: { documentId: script.page.id },
						evidenceSpan: e.span,
						images: []
					}
				}
			])
		),
		...script.links.map((link, i) =>
			toolCallStep([
				{
					id: `link-${script.page.id}-${i}`,
					name: 'relation_propose',
					input: {
						fromLocalId: link.fromLocalId,
						toLocalId: link.toLocalId,
						label: 'part of',
						inverseLabel: 'contains',
						cardinality: 'many_to_one',
						sourceRef: { documentId: script.page.id },
						evidenceSpan: link.span
					}
				}
			])
		),
		toolCallStep([
			{
				id: `finish-${script.page.id}`,
				name: 'job_finish',
				input: { outcome: 'completed', summary: '' }
			}
		])
	]);
}

describe('a first import of a page hierarchy: both ends of every relation are new (issue #613)', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function fixture() {
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });
		const userId = `w613-${randomUUID().slice(0, 8)}`;
		await db.insert(user).values({
			id: userId,
			name: 'Notebook GM',
			email: `${userId}@canonry.invalid`,
			emailVerified: true
		});
		const [u] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Nuova Luce',
				slug: `nuova-luce-${randomUUID().slice(0, 8)}`,
				kind: 'homebrew'
			})
			.returning();
		if (!u) throw new Error('fixture setup failed');
		return { userId, universeId: u.id };
	}

	async function runImport(scripts: Script[], playbookId: 'onenote' | 'obsidian' = 'onenote') {
		const { userId, universeId } = await fixture();
		const playbook = await loadBuiltinPlaybook(playbookId);
		const documents = scripts.map((s) => ({ id: s.page.id, sourcePath: s.page.sourcePath }));
		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: playbookId,
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 'notebook.onepkg',
			artefactBytes: 2048,
			artefactSha256: createHash('sha256').update(randomUUID()).digest('hex'),
			documentCount: documents.length,
			budgetCredits: 1000,
			estimate: { documentCount: documents.length, estimatedMinutes: 1, estimatedCredits: 10 },
			// issue #658: a budget no sibling file can spend. `TEST_CONCURRENCY_LIMIT` has why.
			concurrencyLimit: TEST_CONCURRENCY_LIMIT
		});
		expect(admission.admitted).toBe(true);

		const steps = stepsFor(scripts);
		let step = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				const next = steps[step++];
				if (!next) throw new Error('the mock model ran out of scripted steps');
				return next;
			}
		});
		const result = await new ImportJobRunner().run({
			db,
			driver: new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model as unknown as LanguageModel)
			}),
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: playbookId,
			userId,
			playbook,
			documents,
			sources: new InMemorySourceReader({
				files: Object.fromEntries(scripts.map((s) => [s.page.sourcePath, s.page.text]))
			}),
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: sameName,
			thresholds: MATCH_THRESHOLDS,
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 60_000
		});

		const rows = await db
			.select()
			.from(proposalTable)
			.innerJoin(proposalPlan, eq(proposalTable.planId, proposalPlan.id))
			.where(eq(proposalPlan.importJobId, admission.jobId));
		return {
			result,
			universeId,
			jobId: admission.jobId,
			proposals: rows.map((r) => r.proposal)
		};
	}

	/** A page and its subpage, each proposed as a new `place`, and the link the folder tree
	 * implies. This is the notebook's whole shape in one document. */
	const HARBOUR: Script = {
		page: {
			id: 'doc-1',
			sourcePath: 'Nuova Luce/Harbour/Docks.htm',
			text: 'The Docks sit under the Harbour district and answer to its warden.'
		},
		entities: [
			{
				localId: 'e1',
				type: 'place',
				name: 'Docks',
				summary: 'The Docks sit under the Harbour district and answer to its warden.',
				span: { start: 0, end: 66 }
			},
			{
				localId: 'e2',
				type: 'place',
				name: 'Harbour',
				summary: 'The Harbour district, which the Docks sit under and whose warden they answer to.',
				span: { start: 4, end: 66 }
			}
		],
		links: [{ fromLocalId: 'e1', toLocalId: 'e2', span: { start: 0, end: 40 } }]
	};

	it('proposes the relation instead of dropping it, with both ends naming the creates', async () => {
		const { result, proposals } = await runImport([HARBOUR]);

		const relations = proposals.filter((p) => p.kind === 'relation');
		expect(relations, 'the link the model was paid to find reaches the queue').toHaveLength(1);
		const link = relations[0]!;
		const creates = proposals.filter((p) => p.kind === 'create');
		expect(creates).toHaveLength(2);
		const byName = new Map(creates.map((c) => [stringField(c.patch, 'name') ?? '', c.id] as const));
		expect(link.targetEntityProposalId).toBe(byName.get('Docks'));
		expect(link.relatedEntityProposalId).toBe(byName.get('Harbour'));
		expect(link.targetEntityId, 'and neither end is an entity yet').toBeNull();
		expect(link.relatedEntityId).toBeNull();

		const [outcome] = result.documents;
		expect(outcome?.droppedRelations, 'deferred, and not counted as a loss').toEqual({
			total: 0,
			bothEndsProposed: 0,
			oneEndProposed: 0,
			noEndProposed: 0,
			selfLoop: 0,
			deferred: 1
		});
	});

	it('carries its own evidence, which is what makes it reviewable at all (guardrail 3)', async () => {
		const { proposals } = await runImport([HARBOUR]);
		const link = proposals.find((p) => p.kind === 'relation');
		expect(stringField(link?.evidence, 'documentId')).toBe('doc-1');
		expect(stringField(objectField(link?.evidence, 'sourceRef'), 'path')).toBe(
			'Nuova Luce/Harbour/Docks.htm'
		);
		expect(objectField(link?.evidence, 'evidenceSpan')).toEqual({ start: 0, end: 40 });
		expect(link?.rationale, 'and a sentence rather than a score').not.toBe('');
	});

	it('is not acceptable until both entries are, and writes canon only on its own accept', async () => {
		const { proposals, universeId } = await runImport([HARBOUR]);
		const link = proposals.find((p) => p.kind === 'relation')!;
		const creates = proposals.filter((p) => p.kind === 'create');

		await expect(acceptProposal(db, { proposalId: link.id })).rejects.toThrow(
			RelationEndpointNotAcceptedError
		);
		await acceptProposal(db, { proposalId: creates[0]!.id });
		await expect(acceptProposal(db, { proposalId: link.id })).rejects.toThrow(
			RelationEndpointNotAcceptedError
		);
		await acceptProposal(db, { proposalId: creates[1]!.id });
		expect(
			await db.select().from(relation).where(eq(relation.universeId, universeId)),
			'both entries accepted, and still nothing in the graph'
		).toEqual([]);

		const accepted = await acceptProposal(db, { proposalId: link.id });
		expect(accepted.outcome).toBe('accepted');
		const written = await db.select().from(relation).where(eq(relation.universeId, universeId));
		expect(written).toHaveLength(1);
		expect(written[0]?.authorKind).toBe('ai_accepted');
	});

	it('settles superseded when the GM rejects one of the entries it needs', async () => {
		const { proposals, universeId } = await runImport([HARBOUR]);
		const link = proposals.find((p) => p.kind === 'relation')!;
		const creates = proposals.filter((p) => p.kind === 'create');

		await rejectProposal(db, { proposalId: creates[0]!.id, reason: null });

		const [settled] = await db.select().from(proposalTable).where(eq(proposalTable.id, link.id));
		expect(settled?.outcome).toBe('superseded');
		expect(settled?.rejectReason).toBe(RELATION_ENDPOINT_REJECTED);
		expect(
			await db.select().from(relation).where(eq(relation.universeId, universeId)),
			'and nothing was written on the way out'
		).toEqual([]);
	});

	it('links across two documents, where one end folded onto the other document\u2019s pending create', async () => {
		// Issue #160's fold, which is the second shape an endpoint can be: a document names
		// an entry an earlier document in this same job already proposed, so there is a
		// pending proposal to point at but no entity and no create of its own.
		const first: Script = {
			page: {
				id: 'doc-1',
				sourcePath: 'Nuova Luce/Harbour.htm',
				text: 'The Harbour district runs the whole waterfront.'
			},
			entities: [
				{
					localId: 'a1',
					type: 'place',
					name: 'Harbour',
					summary: 'The Harbour district runs the whole waterfront.',
					span: { start: 0, end: 47 }
				}
			],
			links: []
		};
		const second: Script = {
			page: {
				id: 'doc-2',
				sourcePath: 'Nuova Luce/Harbour/Fishmarket.htm',
				text: 'The Fishmarket is part of the Harbour and opens before dawn.'
			},
			entities: [
				{
					localId: 'b1',
					type: 'place',
					name: 'Fishmarket',
					summary: 'The Fishmarket is part of the Harbour and opens before dawn.',
					span: { start: 0, end: 60 }
				},
				{
					localId: 'b2',
					type: 'place',
					name: 'Harbour',
					summary: 'The Harbour, which the Fishmarket is part of and which opens before dawn.',
					span: { start: 26, end: 60 }
				}
			],
			links: [{ fromLocalId: 'b1', toLocalId: 'b2', span: { start: 0, end: 40 } }]
		};

		const { proposals, universeId } = await runImport([first, second]);
		const creates = proposals.filter((p) => p.kind === 'create');
		expect(
			creates.map((c) => stringField(c.patch, 'name')).sort(),
			'the second sighting of Harbour folded, so there is one create for it, not two'
		).toEqual(['Fishmarket', 'Harbour']);

		const link = proposals.find((p) => p.kind === 'relation');
		expect(link, 'and the relation across the two documents survived').toBeDefined();
		const harbour = creates.find((c) => stringField(c.patch, 'name') === 'Harbour')!;
		const fishmarket = creates.find((c) => stringField(c.patch, 'name') === 'Fishmarket')!;
		expect(link?.targetEntityProposalId).toBe(fishmarket.id);
		expect(link?.relatedEntityProposalId, 'pointing at the create it folded onto').toBe(harbour.id);

		await acceptProposal(db, { proposalId: harbour.id });
		await acceptProposal(db, { proposalId: fishmarket.id });
		await acceptProposal(db, { proposalId: link!.id });
		expect(
			await db.select().from(relation).where(eq(relation.universeId, universeId))
		).toHaveLength(1);
	});

	it('still drops a relation whose end the engine declined, and says which loss that was', async () => {
		// The residue #613 does not recover, and the only one left. `isBareMention` (issue
		// #479) refuses a payload whose name the source only ever mentions inside a link and
		// whose body shares no content word with that source: there is no proposal for that
		// end, so no accept order reaches this relation and only a later import can.
		//
		// An Obsidian note rather than a OneNote page, because that guard is a claim about
		// how the source refers to something and only a format with link syntax lets it be
		// checked (`isBareMention`'s own comment). Which is also why the notebook measured
		// zero of these: nothing in a OneNote export can trip it.
		const script: Script = {
			page: {
				id: 'doc-1',
				sourcePath: 'Vault/Docks.md',
				text: 'The Docks sit under [[Harbour]] and answer to its warden.'
			},
			entities: [
				{
					localId: 'e1',
					type: 'place',
					name: 'Docks',
					summary: 'The Docks sit under Harbour and answer to its warden.',
					span: { start: 0, end: 56 }
				},
				{
					localId: 'e2',
					type: 'place',
					name: 'Harbour',
					summary: 'Un luogo citato altrove nel taccuino.',
					span: { start: 20, end: 56 }
				}
			],
			links: [{ fromLocalId: 'e1', toLocalId: 'e2', span: { start: 0, end: 40 } }]
		};

		const { result, proposals } = await runImport([script], 'obsidian');
		expect(proposals.filter((p) => p.kind === 'relation')).toHaveLength(0);
		const [outcome] = result.documents;
		expect(outcome?.droppedRelations).toEqual({
			total: 1,
			bothEndsProposed: 0,
			oneEndProposed: 0,
			noEndProposed: 1,
			selfLoop: 0,
			deferred: 0
		});
	});
});
