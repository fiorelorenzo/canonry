/**
 * Issue #573: what a document that produced no proposal costs on the next import.
 *
 * `entity_source_ref` used to be written only when a GM accepted a proposal, and `run()`'s
 * skip reads that table, so a document the engine deliberately produced nothing for left no
 * row behind and every later import re-read it, re-ran the driver on it and paid for the
 * tokens again. Nothing about canon was wrong (SPEC.md §6.4's acceptance test is that the
 * second run produces zero changes, and it did: the same nothing), which is why the fix is
 * measured in model calls and in database rows rather than in proposals.
 *
 * Every test here runs the same document through two whole jobs against a real Postgres and
 * the real `GatewayDriver`, and reports two things: how many model calls the driver made in
 * total, and which `entity_source_ref` rows exist afterwards. The model is a
 * `MockLanguageModelV4` whose scripted steps cycle, so a second pass over the same document
 * is a real second pass rather than an exhausted script, and `doGenerateCalls` counts it.
 *
 * The five cases are the outcome table `declinedDocumentEarnsSourceRef` implements. Two earn
 * a ref and are skipped; three do not and are read again, and each of those three would lose
 * a document forever if it were skipped, which is why the bias runs that way.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { closeDb, eq, type Db } from '@canonry/db';
import {
	entity,
	entitySourceRef,
	operationPrice,
	proposal as proposalTable,
	universe,
	user
} from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
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
import { EMBEDDING_MATCH_THRESHOLDS } from './matching.js';
import type { SimilarityFn } from './matching.js';
import type { Embedder } from '@canonry/copilot';

// This file drops and creates nothing, for the reason job-runner-guards.test.ts states:
// `test-global-setup.ts` owns the one database, and a second dropper inside a test file is
// the collision AGENTS.md describes. Every fixture below gets its own universe and its own
// document paths, so a shared database is all it needs. The paths matter as much as the
// universe: `entity_source_ref_external_key` is unique on `(source_system, external_id)`
// across the whole table, so two tests sharing a path would fight over one row.

const stubEmbedRelationLabel: Embedder = async (texts) => texts.map(() => [0, 0, 0]);
const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;
const TEST_PARAMS = { pricePerInputMTok: 1, pricePerOutputMTok: 2, creditsPerEur: 100 };

/** Nothing here reaches the scorer: every case resolves (or fails to resolve) on a
 * deterministic identity collision, which is SPEC.md §6.4's free rung and needs no
 * embedding. A similarity that answers 0.1 to everything makes that explicit rather than
 * leaving a real embedder wired to a test that never wants one. */
const noSemanticMatch: SimilarityFn = () => 0.1;

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

interface ScriptedCall {
	name: string;
	/** A string is passed to the SDK verbatim, which is how a call that cannot parse against
	 * its tool's schema is scripted (a real one is a response truncated by the output limit). */
	input: unknown;
}

/**
 * A model whose steps cycle: call N answers with step `N % steps.length`. Cycling is what
 * makes a second job over the same document a faithful second pass rather than a script
 * that ran out, and it is only correct because every pass over one document runs the
 * identical step sequence.
 */
function cyclingModel(steps: ScriptedCall[]): MockLanguageModelV4 {
	let index = 0;
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: async () => {
			const call = steps[index % steps.length];
			index += 1;
			if (!call) throw new Error('cyclingModel: empty step script');
			return {
				content: [
					{
						type: 'tool-call' as const,
						toolCallId: `c${index}`,
						toolName: call.name,
						input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input)
					}
				],
				finishReason: { unified: 'tool-calls' as const, raw: undefined },
				usage: usage(10, 5),
				warnings: []
			};
		}
	});
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

function read(path: string): ScriptedCall {
	return { name: 'source_read', input: { path } };
}

function propose(payload: {
	localId: string;
	type: string;
	name: string;
	summary: string;
	span: { start: number; end: number };
}): ScriptedCall {
	return {
		name: 'entity_propose',
		input: {
			localId: payload.localId,
			type: payload.type,
			name: payload.name,
			aliases: [],
			summary: payload.summary,
			sourceRef: { documentId: 'doc-1' },
			evidenceSpan: payload.span,
			images: []
		}
	};
}

function finish(outcome: 'completed' | 'skipped'): ScriptedCall {
	return { name: 'job_finish', input: { outcome, summary: '' } };
}

interface SeededEntity {
	type: 'place' | 'faction';
	name: string;
	slug: string;
	body: string;
}

interface RunReport {
	/** Every model call the driver made across both jobs. A document skipped on the second
	 * run leaves this at the first run's count. */
	modelCalls: number;
	firstRunModelCalls: number;
	/** `DocumentOutcome.status` of the one document, per run. `'skipped_unchanged'` on the
	 * second run is the fix working. */
	statuses: [string, string];
	/** `(external_id, entity name)` after each run, which is the claim about database state
	 * rather than about a call count. */
	refsAfterFirst: Array<[string, string]>;
	refsAfterSecond: Array<[string, string]>;
	proposalCount: number;
}

describe('issue #573: a document that produced no proposal', () => {
	let db: Db;

	beforeAll(() => {
		db = openTestDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function seed(entities: SeededEntity[]) {
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });

		const userId = `i573-${randomUUID().slice(0, 8)}`;
		await db.insert(user).values({
			id: userId,
			name: 'Valdoria GM',
			email: `${userId}@canonry.invalid`,
			emailVerified: true
		});
		const [u] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Valdoria Reach',
				slug: `valdoria-reach-${randomUUID().slice(0, 8)}`,
				kind: 'homebrew'
			})
			.returning();
		if (!u) throw new Error('fixture setup failed');
		if (entities.length > 0) {
			await db.insert(entity).values(entities.map((row) => ({ ...row, universeId: u.id })));
		}
		return { userId, universeId: u.id };
	}

	async function refsFor(universeId: string): Promise<Array<[string, string]>> {
		const rows = await db
			.select({ externalId: entitySourceRef.externalId, name: entity.name })
			.from(entitySourceRef)
			.innerJoin(entity, eq(entity.id, entitySourceRef.entityId))
			.where(eq(entity.universeId, universeId));
		return rows
			.map((row): [string, string] => [row.externalId ?? '(none)', row.name])
			.sort((a, b) => a[0].localeCompare(b[0]));
	}

	/** Runs the same one-document export through two complete jobs, the way a GM who
	 * exports again a month later does, and reports what each run cost and left behind. */
	async function importTwice(fixture: {
		seeded: SeededEntity[];
		sourcePath: string;
		text: string;
		steps: ScriptedCall[];
	}): Promise<RunReport> {
		const { userId, universeId } = await seed(fixture.seeded);
		const playbook = await loadBuiltinPlaybook('obsidian');
		const documents = [{ id: 'doc-1', sourcePath: fixture.sourcePath }];
		const model = cyclingModel(fixture.steps);
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});

		async function runOnce(): Promise<string> {
			const admission = await admitAndCreateImportJob(db, {
				universeId,
				createdBy: userId,
				sourceType: 'obsidian',
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: `/tmp/${fixture.sourcePath}.zip`,
				artefactBytes: 1024,
				artefactSha256: createHash('sha256').update(fixture.text).digest('hex'),
				documentCount: documents.length,
				budgetCredits: 1000,
				estimate: { documentCount: documents.length, estimatedMinutes: 1, estimatedCredits: 10 },
				concurrencyLimit: 5
			});
			expect(admission.admitted).toBe(true);
			const result = await new ImportJobRunner().run({
				db,
				driver,
				dbJobId: admission.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents,
				sources: new InMemorySourceReader({ files: { [fixture.sourcePath]: fixture.text } }),
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: noSemanticMatch,
				thresholds: EMBEDDING_MATCH_THRESHOLDS,
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 60_000
			});
			return result.documents[0]?.status ?? '(no outcome)';
		}

		const firstStatus = await runOnce();
		const firstRunModelCalls = model.doGenerateCalls.length;
		const refsAfterFirst = await refsFor(universeId);
		const secondStatus = await runOnce();
		const proposals = await db
			.select({ id: proposalTable.id })
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));

		return {
			modelCalls: model.doGenerateCalls.length,
			firstRunModelCalls,
			statuses: [firstStatus, secondStatus],
			refsAfterFirst,
			refsAfterSecond: await refsFor(universeId),
			proposalCount: proposals.length
		};
	}

	// -----------------------------------------------------------------------------------
	// Earns a ref: the whole document belongs to exactly one entity the universe carries.
	// -----------------------------------------------------------------------------------

	it('is read once and skipped afterwards when every sighting was a bare mention of one existing entry', async () => {
		const dir = `vault-${randomUUID().slice(0, 8)}`;
		const sourcePath = `${dir}/Notes/Quay Rumours.md`;
		const report = await importTwice({
			seeded: [
				{
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: 'the-ashen-ledger',
					body: 'A merchant bank that lends at knife point and keeps better records than the magistrate.'
				}
			],
			sourcePath,
			// The note never talks about the Ledger: the name occurs once, inside a wikilink.
			// This is issue #479's Cairnmouth shape, and #574 made a whole document of it
			// reachable - a vault of notes that only cross-link entries the universe holds.
			text: `---
tags: [note]
---

# Quay Rumours

Somebody has been buying up harbour debts before the thaw, quietly and through intermediaries.

Ask [[The Ashen Ledger]] about it when the party next docks.
`,
			steps: [
				read(sourcePath),
				propose({
					localId: 'e1',
					type: 'faction',
					name: 'The Ashen Ledger',
					summary: 'A faction connected with unspecified financial dealings.',
					span: { start: 0, end: 40 }
				}),
				finish('completed')
			]
		});

		// Guardrail 3 held: nothing was proposed, in either run.
		expect(report.proposalCount).toBe(0);
		// The claim is about database state first: one provenance row, pointing at the entry
		// the document is about, keyed by the path `run()`'s skip looks up. Before the fix
		// this was `[]` after both runs.
		expect(report.refsAfterFirst).toEqual([[sourcePath, 'The Ashen Ledger']]);
		expect(report.refsAfterSecond).toEqual([[sourcePath, 'The Ashen Ledger']]);
		// And so the engine looked once: three steps, and the second job added none.
		expect(report.firstRunModelCalls).toBe(3);
		expect(report.modelCalls).toBe(3);
		expect(report.statuses).toEqual(['finished', 'skipped_unchanged']);
	});

	it('is read once and skipped afterwards when the only update it could make adds nothing', async () => {
		const dir = `vault-${randomUUID().slice(0, 8)}`;
		const sourcePath = `${dir}/Factions/The Ashen Ledger.md`;
		const report = await importTwice({
			seeded: [
				{
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: 'the-ashen-ledger',
					body: `A merchant bank that lends at knife point and keeps better records than the magistrate.

:::secret
Aldric Vane, the dismissed captain of the Valdoria Watch, is now on the Ashen Ledger's payroll.
:::`
				}
			],
			sourcePath,
			// This one is not a bare mention at all: the note is about the Ledger and says so
			// in prose. What makes it produce nothing is the pair of #479 guards #574 shipped
			// - the body write is refused because accepting it would delete a `:::secret`
			// fence, and what is left of the patch repeats the entity's own name.
			text: `---
tags: [faction]
---

# The Ashen Ledger

A merchant bank that lends at knife point and keeps better records than the magistrate.
`,
			steps: [
				read(sourcePath),
				propose({
					localId: 'e1',
					type: 'faction',
					name: 'The Ashen Ledger',
					summary: 'The Ashen Ledger is a merchant bank.',
					span: { start: 0, end: 40 }
				}),
				finish('completed')
			]
		});

		expect(report.proposalCount).toBe(0);
		expect(report.refsAfterFirst).toEqual([[sourcePath, 'The Ashen Ledger']]);
		expect(report.refsAfterSecond).toEqual([[sourcePath, 'The Ashen Ledger']]);
		expect(report.firstRunModelCalls).toBe(3);
		expect(report.modelCalls).toBe(3);
		expect(report.statuses).toEqual(['finished', 'skipped_unchanged']);
	});

	// -----------------------------------------------------------------------------------
	// Earns nothing: read again, because skipping would lose something.
	// -----------------------------------------------------------------------------------

	it('is read again when the model call failed, since a truncated run is not a decision', async () => {
		const dir = `vault-${randomUUID().slice(0, 8)}`;
		const sourcePath = `${dir}/Notes/Quay Rumours.md`;
		const report = await importTwice({
			seeded: [
				{
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: 'the-ashen-ledger',
					body: 'A merchant bank that lends at knife point.'
				}
			],
			sourcePath,
			text: `# Quay Rumours

Somebody has been buying up harbour debts. Ask [[The Ashen Ledger]] about it.
`,
			// A response the SDK cannot parse against `entity_propose`'s schema, which is
			// what a call truncated by the output limit looks like. It never varies, so
			// every retry issue #273 buys fails the same way and the document fails.
			steps: [{ name: 'entity_propose', input: '{"localId":"e1","type":"faction","name":"The As' }]
		});

		expect(report.statuses).toEqual(['failed', 'failed']);
		// Four calls per run: one attempt plus STEP_PARSE_RETRY_LIMIT retries. The second
		// run paid for the document again, which is the point: nothing was decided about it.
		expect(report.firstRunModelCalls).toBe(4);
		expect(report.modelCalls).toBe(8);
		expect(report.refsAfterFirst).toEqual([]);
		expect(report.refsAfterSecond).toEqual([]);
	});

	it('is read again when the model closed it as skipped, because there is no entity for a ref to name', async () => {
		const dir = `vault-${randomUUID().slice(0, 8)}`;
		const sourcePath = `${dir}/Templates/Session template.md`;
		const report = await importTwice({
			seeded: [],
			sourcePath,
			text: `---
tags: [template]
---

# Session template

- Recap:
- Scenes:
- Loot:
`,
			steps: [read(sourcePath), finish('skipped')]
		});

		// The known remaining leak, pinned rather than left to be discovered again: an empty
		// note or a template buffers no sighting, so there is no entity a source ref could
		// point at, and `entity_source_ref.entity_id` is NOT NULL with no `universe_id` of
		// its own. Recording this needs a document-level row, which is a migration.
		expect(report.statuses).toEqual(['finished', 'finished']);
		expect(report.firstRunModelCalls).toBe(2);
		expect(report.modelCalls).toBe(4);
		expect(report.refsAfterSecond).toEqual([]);
	});

	it('is read again when its sightings belong to two different entries, rather than guessing which one owns the path', async () => {
		const dir = `vault-${randomUUID().slice(0, 8)}`;
		const sourcePath = `${dir}/Notes/Quay Rumours.md`;
		const report = await importTwice({
			seeded: [
				{
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: 'the-ashen-ledger',
					body: 'A merchant bank that lends at knife point and keeps better records than the magistrate.'
				},
				{
					type: 'place',
					name: 'Cairnmouth',
					slug: 'cairnmouth',
					body: 'A fishing town two days up the coast, whose harbour never recovered from the winter.'
				}
			],
			sourcePath,
			text: `---
tags: [note]
---

# Quay Rumours

Somebody has been buying up harbour debts before the thaw, quietly and through intermediaries.

Ask [[The Ashen Ledger]] about it, and ask again in [[Cairnmouth]] when the party next docks.
`,
			steps: [
				read(sourcePath),
				propose({
					localId: 'e1',
					type: 'faction',
					name: 'The Ashen Ledger',
					summary: 'A faction connected with unspecified financial dealings.',
					span: { start: 0, end: 40 }
				}),
				propose({
					localId: 'e2',
					type: 'place',
					name: 'Cairnmouth',
					summary: 'A place connected with unspecified financial dealings.',
					span: { start: 0, end: 40 }
				}),
				finish('completed')
			]
		});

		// One path can hold one `entity_source_ref` row and that row names one entity, and
		// `findEntityBySourceRef` is SPEC.md §6.4 step 1: `resolveMatch` answers `exact` on
		// it without looking at the name. A row naming whichever of the two came first would
		// make a later import propose an update to the wrong entry, which is the false merge
		// §6.4 weights heaviest. Paying for the document again is the cheaper error.
		expect(report.proposalCount).toBe(0);
		expect(report.firstRunModelCalls).toBe(4);
		expect(report.modelCalls).toBe(8);
		expect(report.statuses).toEqual(['finished', 'finished']);
		expect(report.refsAfterSecond).toEqual([]);
	});
});
