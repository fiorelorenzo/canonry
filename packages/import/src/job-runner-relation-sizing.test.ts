/**
 * Issue #628, end to end: the entity types a relation type is sized from have to be the
 * types of the things the relation's ends actually resolved onto, not whatever the document
 * being read called them.
 *
 * **Why this file exists as well as `packages/db/test/relation-type-admission.test.ts`.**
 * That one owns the accept-time refusal, which stays and is right. This one owns the two
 * upstream causes that made a correct refusal fire on relations nobody should ever have been
 * asked about, measured on the OneNote notebook as 5 of its 9 refusals:
 *
 *   - two of them because a relation's end folded onto an earlier document's `create` (or
 *     onto an entity that already existed) whose declared type differed from this document's
 *     own word for the same name. `job-runner.ts` sized the type from `localIdToType`, its
 *     per-document map of what the model said, so `esercito della` came out as
 *     faction -> faction while the end it pointed at was a place;
 *   - three of them because the label matched the shipped `member of`'s *inverse* label
 *     ("ha come membro"), and the resolver's admission check ran on the swapped pair while
 *     the row was written in the model's own order. `isInverseMatch` was exported for a
 *     caller to re-derive that, and no caller ever did.
 *
 * Both fail on f94c9d7. The sizing cases fail on the assertion about the vocabulary
 * proposal's `allowedFrom`/`allowedTo`, and the inverse case fails twice over: the relation
 * proposal is written with its ends the wrong way round, and the accept that follows is
 * refused by #191.
 *
 * **What is real and what is scripted.** Same substitution as
 * `job-runner-relations.test.ts`: a real `GatewayDriver` over a `MockLanguageModelV4`
 * scripting the tool calls, with the playbook, the tool surface, the merge engine, the plan
 * writer and Postgres all real. The relation-label embedder returns zero vectors, so
 * `resolveRelationType`'s semantic rung can never fire and every case here turns on rung 1
 * or on the new-type fallthrough, both deterministic.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { acceptProposal, acceptRelationTypeProposal, closeDb, eq, type Db } from '@canonry/db';
import {
	entity,
	operationPrice,
	proposal as proposalTable,
	proposalPlan,
	relation,
	relationType,
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

const stubEmbedRelationLabel: Embedder = async (texts) => texts.map(() => [0, 0, 0]);

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

/** `proposal.patch` is jsonb, so the compiler knows nothing about it. Narrowed rather than
 * asserted, the same way `job-runner-relations.test.ts` does it. */
function stringField(value: unknown, key: string): string | null {
	if (typeof value !== 'object' || value === null || !(key in value)) return null;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === 'string' ? field : null;
}

function stringArrayField(value: unknown, key: string): string[] | null {
	if (typeof value !== 'object' || value === null || !(key in value)) return null;
	const field = (value as Record<string, unknown>)[key];
	if (!Array.isArray(field)) return null;
	return field.filter((item): item is string => typeof item === 'string');
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
	label: string;
	inverseLabel: string;
	span: { start: number; end: number };
}

interface Script {
	page: { id: string; sourcePath: string; text: string };
	entities: Entity[];
	links: Link[];
}

/** Same shape as `job-runner-relations.test.ts`'s own `stepsFor`, except the label travels
 * per link rather than being fixed to the catalogue's `part of`: which label is proposed is
 * the whole subject here. */
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
						label: link.label,
						inverseLabel: link.inverseLabel,
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

describe('sizing a relation type from the ends it actually has (issue #628)', () => {
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
		const userId = `w628-${randomUUID().slice(0, 8)}`;
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

	async function runImport(scripts: Script[], seed?: (universeId: string) => Promise<void>) {
		const { userId, universeId } = await fixture();
		if (seed) await seed(universeId);
		const playbook = await loadBuiltinPlaybook('onenote');
		const documents = scripts.map((s) => ({ id: s.page.id, sourcePath: s.page.sourcePath }));
		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'onenote',
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
		await new ImportJobRunner().run({
			db,
			driver: new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model as unknown as LanguageModel)
			}),
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'onenote',
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
		return { universeId, jobId: admission.jobId, proposals: rows.map((r) => r.proposal) };
	}

	it("sizes a new type from the earlier document's create the end folded onto, not this document's word for it", async () => {
		// The notebook's `esercito della`: doc-19 called Martello di Korr a place, doc-31
		// called the same name a faction and drew the relation. The end resolves onto doc-19's
		// pending create, so the type has to admit a place at that end or the accept cannot
		// write the row the import just proposed.
		const first: Script = {
			page: {
				id: 'doc-1',
				sourcePath: 'Nuova Luce/Martello di Korr.htm',
				text: 'Martello di Korr is the fortress that guards the pass.'
			},
			entities: [
				{
					localId: 'a1',
					type: 'place',
					name: 'Martello di Korr',
					summary: 'Martello di Korr is the fortress that guards the pass.',
					span: { start: 0, end: 53 }
				}
			],
			links: []
		};
		const second: Script = {
			page: {
				id: 'doc-2',
				sourcePath: 'Nuova Luce/Era della Rinascita.htm',
				text: 'Martello di Korr is the standing army of the Lega di Korr.'
			},
			entities: [
				{
					localId: 'b1',
					type: 'faction',
					name: 'Martello di Korr',
					summary: 'Martello di Korr is the standing army of the Lega di Korr.',
					span: { start: 0, end: 57 }
				},
				{
					localId: 'b2',
					type: 'faction',
					name: 'Lega di Korr',
					summary: 'The Lega di Korr, whose standing army is the Martello di Korr.',
					span: { start: 44, end: 57 }
				}
			],
			links: [
				{
					fromLocalId: 'b1',
					toLocalId: 'b2',
					label: 'esercito della',
					inverseLabel: 'ha come esercito',
					span: { start: 0, end: 57 }
				}
			]
		};

		const { proposals } = await runImport([first, second]);

		const vocab = proposals.filter((p) => p.kind === 'relation_type_new');
		expect(vocab, 'an unfamiliar label is one vocabulary question').toHaveLength(1);
		expect(stringField(vocab[0]!.patch, 'label')).toBe('esercito della');
		expect(
			stringArrayField(vocab[0]!.patch, 'allowedFrom'),
			'the end folded onto a place, so the type it will create has to admit a place'
		).toEqual(['place']);
		expect(stringArrayField(vocab[0]!.patch, 'allowedTo')).toEqual(['faction']);
	});

	it('sizes from an existing entity when the end folded onto canon rather than a proposal', async () => {
		// The same disagreement with the other endpoint shape, which is the one the issue
		// itself names: a fold onto an existing entry keeps that entry's type.
		const script: Script = {
			page: {
				id: 'doc-1',
				sourcePath: 'Nuova Luce/Zona di Guerra.htm',
				text: 'Forte Glottenham is where the Martello di Korr operates from.'
			},
			entities: [
				{
					localId: 'c1',
					type: 'faction',
					name: 'Forte Glottenham',
					summary: 'Forte Glottenham is where the Martello di Korr operates from.',
					span: { start: 0, end: 60 }
				},
				{
					localId: 'c2',
					type: 'place',
					name: 'Zona di Guerra',
					summary: 'The Zona di Guerra, which Forte Glottenham stands in.',
					span: { start: 0, end: 30 }
				}
			],
			links: [
				{
					fromLocalId: 'c1',
					toLocalId: 'c2',
					label: 'opera da',
					inverseLabel: 'ha sede a',
					span: { start: 0, end: 60 }
				}
			]
		};

		const { proposals } = await runImport([script], async (universeId) => {
			await db.insert(entity).values({
				universeId,
				type: 'place',
				name: 'Forte Glottenham',
				slug: 'forte-glottenham',
				aliases: [],
				body: 'A fort on the northern road.'
			});
		});

		const vocab = proposals.filter((p) => p.kind === 'relation_type_new');
		expect(vocab).toHaveLength(1);
		expect(
			stringArrayField(vocab[0]!.patch, 'allowedFrom'),
			'the entity at that end is a place, whatever the document called it'
		).toEqual(['place']);
	});

	it("writes the row in the type's own direction when the label matched its inverse, and the accept goes through", async () => {
		// The notebook's `member of` three, in English: "has member" is the shipped `member
		// of`'s own inverse label, so this is one type read backwards rather than a new one.
		const script: Script = {
			page: {
				id: 'doc-1',
				sourcePath: 'Nuova Luce/X Astartes 5.htm',
				text: 'X Astartes 5 counts Myra among its members.'
			},
			entities: [
				{
					localId: 'd1',
					type: 'faction',
					name: 'X Astartes 5',
					summary: 'X Astartes 5 counts Myra among its members.',
					span: { start: 0, end: 43 }
				},
				{
					localId: 'd2',
					type: 'character',
					name: 'Myra',
					summary: 'Myra, who is one of the members of X Astartes 5.',
					span: { start: 20, end: 43 }
				}
			],
			links: [
				{
					fromLocalId: 'd1',
					toLocalId: 'd2',
					label: 'has member',
					inverseLabel: 'member of',
					span: { start: 0, end: 43 }
				}
			]
		};

		const { proposals, universeId } = await runImport([script]);

		// Rung 1b matched the shipped type, so there is no vocabulary question at all.
		expect(proposals.filter((p) => p.kind.startsWith('relation_type_'))).toHaveLength(0);
		const links = proposals.filter((p) => p.kind === 'relation');
		expect(links).toHaveLength(1);
		const link = links[0]!;
		const creates = proposals.filter((p) => p.kind === 'create');
		const byName = new Map(creates.map((c) => [stringField(c.patch, 'name') ?? '', c.id] as const));
		expect(
			link.targetEntityProposalId,
			'"X Astartes 5 has member Myra" is "Myra member of X Astartes 5", so Myra is the from end'
		).toBe(byName.get('Myra'));
		expect(link.relatedEntityProposalId).toBe(byName.get('X Astartes 5'));

		for (const create of creates) await acceptProposal(db, { proposalId: create.id });
		const accepted = await acceptProposal(db, { proposalId: link.id });
		expect(accepted.outcome, 'and #191 admits it, because it now reads the way the type does').toBe(
			'accepted'
		);

		const written = await db
			.select({
				fromEntityId: relation.fromEntityId,
				toEntityId: relation.toEntityId,
				label: relationType.label
			})
			.from(relation)
			.innerJoin(relationType, eq(relationType.id, relation.relationTypeId))
			.where(eq(relation.universeId, universeId));
		expect(written).toHaveLength(1);
		expect(written[0]?.label).toBe('member of');
		const [myra] = await db.select({ id: entity.id }).from(entity).where(eq(entity.name, 'Myra'));
		expect(written[0]?.fromEntityId, 'one row, in the catalogue direction').toBe(myra?.id);
	});

	it('a relation the GM has to answer a vocabulary question for still lands in the right direction', async () => {
		// The inverse match and the vocabulary path composing, on the notebook's own case:
		// "has member" is the shipped `member of`'s inverse label, and `member of` admits
		// character -> faction, so a oneshot typed as an `event` at the far end is a gap on a
		// shipped type. A shipped row only changes in a release, so that forks a
		// universe-scoped `member of` instead, and the relation waiting on that question has
		// to be held in the forked type's direction rather than the model's.
		//
		// This is exactly what the notebook produced: a universe-scoped `member of` admitting
		// character -> event, carrying four of its relations.
		const script: Script = {
			page: {
				id: 'doc-1',
				sourcePath: 'Nuova Luce/Spada di Phandalin.htm',
				text: 'Storia della Spada di Phandalin counts Malia among its members.'
			},
			entities: [
				{
					localId: 'e1',
					type: 'event',
					name: 'Storia della Spada di Phandalin',
					summary: 'Storia della Spada di Phandalin counts Malia among its members.',
					span: { start: 0, end: 62 }
				},
				{
					localId: 'e2',
					type: 'character',
					name: 'Malia',
					summary: 'Malia, one of the members of the Storia della Spada di Phandalin.',
					span: { start: 38, end: 62 }
				}
			],
			links: [
				{
					fromLocalId: 'e1',
					toLocalId: 'e2',
					label: 'has member',
					inverseLabel: 'member of',
					span: { start: 0, end: 62 }
				}
			]
		};

		const { proposals, universeId } = await runImport([script]);

		const vocab = proposals.filter((p) => p.kind === 'relation_type_new');
		expect(vocab, 'a gap on a shipped type forks rather than widening it').toHaveLength(1);
		expect(
			stringField(vocab[0]!.patch, 'label'),
			"under the catalogue's own label, not the model's phrasing"
		).toBe('member of');
		expect(
			stringArrayField(vocab[0]!.patch, 'allowedFrom'),
			'sized in the type\u2019s own direction: the character is the "member of" end'
		).toEqual(['character']);
		expect(stringArrayField(vocab[0]!.patch, 'allowedTo')).toEqual(['event']);

		for (const create of proposals.filter((p) => p.kind === 'create')) {
			await acceptProposal(db, { proposalId: create.id });
		}
		const unblocked = await acceptRelationTypeProposal(db, { proposalId: vocab[0]!.id });
		expect(unblocked.unblockedProposalIds).toHaveLength(1);
		const accepted = await acceptProposal(db, { proposalId: unblocked.unblockedProposalIds[0]! });
		expect(accepted.outcome, 'and the accept is admitted rather than refused').toBe('accepted');

		const written = await db
			.select({ fromEntityId: relation.fromEntityId })
			.from(relation)
			.where(eq(relation.universeId, universeId));
		const [malia] = await db.select({ id: entity.id }).from(entity).where(eq(entity.name, 'Malia'));
		expect(written).toHaveLength(1);
		expect(written[0]?.fromEntityId).toBe(malia?.id);
	});
});
