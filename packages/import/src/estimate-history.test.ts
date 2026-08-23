/**
 * Issue #610: which `import_job` rows are evidence about what a document costs.
 *
 * `estimate.test.ts` next door is the pure-function half of `estimate.ts` and stays
 * database-free; this file is the historical-average branch, against a real Postgres,
 * because the whole question the issue asks is which rows a real query returns. It used to
 * be exercised only from `apps/web/src/lib/server/onboarding.test.ts`, which reaches the
 * cold-start branch and nothing else, so the filter this issue is about had no test at all.
 *
 * Every test uses a playbook id of its own (`playbookId()` below). `estimateAveragesForPlaybook`
 * filters by playbook and by nothing else - not by universe, not by user - so a shared id
 * would make this file race every other file in the package that writes an `import_job` row
 * (AGENTS.md's note on the fork pool and one database per run). A unique id is a stronger
 * guarantee than a lock and costs nothing.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getImportJob, type Db } from '@canonry/db';
import { importJob, operationPrice, universe, user } from '@canonry/db/schema';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
	estimateAveragesForPlaybook,
	UNMEASURED_PLAYBOOK_ESTIMATE,
	type PlaybookEstimateBasis
} from './estimate.js';
import {
	admitAndCreateImportJob,
	estimateImportJob,
	ImportJobRunner,
	type RunImportJobParams
} from './job-runner.js';
import {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector
} from './gateway-driver.js';
import { loadPlaybook } from './playbook.js';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import type { Embedder } from '@canonry/copilot';
import { openTestDb } from './test-db.js';

let db: Db;
let universeId: string;
let userId: string;

beforeAll(async () => {
	db = openTestDb();
	userId = `w610-user-${randomUUID().slice(0, 8)}`;
	await db.insert(user).values({
		id: userId,
		name: 'Estimate History',
		email: `${userId}@canonry.invalid`,
		emailVerified: true
	});
	const [row] = await db
		.insert(universe)
		.values({
			ownerUserId: userId,
			name: 'Estimate History World',
			slug: `w610-world-${randomUUID().slice(0, 8)}`,
			kind: 'homebrew'
		})
		.returning();
	if (!row) throw new Error('fixture failed: no universe');
	universeId = row.id;
});

afterAll(async () => {
	await closeDb(db);
});

function playbookId(): string {
	return `w610-${randomUUID().slice(0, 8)}`;
}

/** One `import_job` row, written the way a settled job leaves it: a `checkpoint` carrying
 * one entry per document that reached a terminal outcome (issue #27's shape, which is what
 * tells a per-document step ceiling from a job-wide credit ceiling), and `document_count`
 * the number the job was admitted with. */
async function insertJob(input: {
	playbook: string;
	status: 'queued' | 'running' | 'finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed';
	documentCount: number;
	spentCredits: number;
	/** Per-document terminal statuses, in order. Fewer entries than `documentCount` is the
	 * shape a job-wide credit ceiling leaves: the rest never started. */
	ran?: ('finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed')[];
	/** Wall clock the job took, or `null` for a row that never recorded one (a job still
	 * running, or one whose settle never landed). */
	seconds: number | null;
}): Promise<string> {
	const ran = input.ran ?? [];
	const documents: Record<string, { status: string }> = {};
	ran.forEach((status, index) => {
		documents[`doc-${index}`] = { status };
	});
	const start = new Date('2026-08-23T10:00:00.000Z');
	const startedAt = input.seconds === null ? null : start;
	const finishedAt =
		input.seconds === null ? null : new Date(start.getTime() + input.seconds * 1000);
	const [row] = await db
		.insert(importJob)
		.values({
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: input.playbook,
			playbookVersion: 1,
			artefactPath: 's3://w610/export.zip',
			artefactBytes: 100,
			artefactSha256: 'a'.repeat(64),
			documentCount: input.documentCount,
			spentCredits: input.spentCredits,
			status: input.status,
			checkpoint: { documents },
			startedAt,
			finishedAt
		})
		.returning();
	if (!row) throw new Error('fixture failed: no import_job');
	return row.id;
}

function ranAll(count: number): ('finished' | 'stopped_at_ceiling')[] {
	return Array.from({ length: count }, () => 'finished' as const);
}

// ---------------------------------------------------------------------------------------
// The status table (#610 item 1): one test per status, and the two stops that share
// `stopped_at_ceiling`.
// ---------------------------------------------------------------------------------------

describe('estimateAveragesForPlaybook: which statuses are evidence (issue #610)', () => {
	it('finished: pooled over document_count, which is what the query has always done', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'finished',
			documentCount: 10,
			spentCredits: 20,
			ran: ranAll(10),
			seconds: 100
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages.avgCreditsPerDocument).toBeCloseTo(2, 10);
		expect(averages.avgSecondsPerDocument).toBeCloseTo(10, 10);
		expect(averages.basis.source).toBe('history');
		expect(averages.basis.jobsPooled).toBe(1);
		expect(averages.basis.documentsPooled).toBe(10);
	});

	it('stopped_at_ceiling on a per-document step ceiling: every document ran, so the whole job is evidence', async () => {
		// #606's obsidian job in miniature: 35 documents, 2 of them out of steps, 33
		// finished, 30.3658 credits. Every document ran, and a document that spent its whole
		// step budget is the dearest a document can be, so this row reads high rather than
		// low - the old `status = 'finished'` filter threw away the best evidence the
		// deployment had produced.
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'stopped_at_ceiling',
			documentCount: 35,
			spentCredits: 30.3658,
			ran: [...ranAll(33), 'stopped_at_ceiling', 'stopped_at_ceiling'],
			seconds: 815
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages.avgCreditsPerDocument).toBeCloseTo(30.3658 / 35, 6);
		expect(averages.basis.source).toBe('history');
		expect(averages.basis.documentsPooled).toBe(35);
	});

	it('stopped_at_ceiling on the job-wide credit ceiling: pooled over the documents that ran, never over the ones that never started', async () => {
		// `GatewayDriver.startJob`'s outer loop returns once `budget.exceeded()`, so the
		// remaining documents never start and cost nothing while still being counted in
		// `document_count`. Dividing 24 credits by 10 documents would read 2.4 and be a
		// number about our own budget rather than about a document; dividing by the 4 that
		// actually ran reads 6.
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'stopped_at_ceiling',
			documentCount: 10,
			spentCredits: 24,
			ran: [...ranAll(3), 'stopped_at_ceiling'],
			seconds: 200
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages.avgCreditsPerDocument).toBeCloseTo(6, 10);
		expect(averages.avgSecondsPerDocument).toBeCloseTo(50, 10);
		expect(averages.basis.documentsPooled).toBe(4);
	});

	it('cancelled: not evidence, however much it spent', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'cancelled',
			documentCount: 10,
			spentCredits: 40,
			ran: ranAll(5),
			seconds: 100
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
	});

	it('failed: not evidence', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'failed',
			documentCount: 10,
			spentCredits: 40,
			ran: [...ranAll(4), 'failed'],
			seconds: 100
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
	});

	it('running: not evidence, because the spend so far is a prefix of the spend', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'running',
			documentCount: 10,
			spentCredits: 4,
			ran: ranAll(2),
			seconds: null
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
	});

	it('queued: not evidence, nothing ran', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'queued',
			documentCount: 10,
			spentCredits: 0,
			seconds: null
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
	});
});

// ---------------------------------------------------------------------------------------
// The optimism guards (#610 item 3): a zero-spend job is not a cheap document.
// ---------------------------------------------------------------------------------------

describe('estimateAveragesForPlaybook: a job that spent nothing is not evidence that a document is cheap', () => {
	it('a re-import whose documents were all unchanged does not drag a real job down with it', async () => {
		// Issue #36: an unchanged document is skipped before the driver ever sees it, so a
		// second import of the same export finishes having spent nothing over a full
		// `document_count`. Pooling it says a document costs a fifth of what the real job
		// next to it measured, which is the exact direction #610 exists to stop.
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'finished',
			documentCount: 10,
			spentCredits: 20,
			ran: ranAll(10),
			seconds: 100
		});
		await insertJob({
			playbook,
			status: 'finished',
			documentCount: 40,
			spentCredits: 0,
			ran: ranAll(40),
			seconds: 10
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages.avgCreditsPerDocument).toBeCloseTo(2, 10);
		expect(averages.basis.jobsPooled).toBe(1);
		expect(averages.basis.documentsPooled).toBe(10);
	});

	it('a ceiling-stopped job refused at its very first step installs no history at all', async () => {
		// `wouldExceedCeiling` can refuse a document's first step before the model is
		// called, so the document reaches a terminal outcome having spent nothing. One
		// document that ran and zero credits is not a measurement of anything.
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'stopped_at_ceiling',
			documentCount: 3,
			spentCredits: 0,
			ran: ['stopped_at_ceiling'],
			seconds: 1
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
	});

	it('a ceiling-stopped job whose checkpoint says no document ran installs no history', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'stopped_at_ceiling',
			documentCount: 5,
			spentCredits: 12,
			ran: [],
			seconds: 50
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
	});

	it('a job with no wall clock recorded does not drag the seconds average down', async () => {
		// A row missing `started_at`/`finished_at` contributes no seconds, so it must not
		// contribute documents to the seconds denominator either: 100 seconds over the 10
		// documents that were timed, not over 20.
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'finished',
			documentCount: 10,
			spentCredits: 20,
			ran: ranAll(10),
			seconds: 100
		});
		await insertJob({
			playbook,
			status: 'finished',
			documentCount: 10,
			spentCredits: 20,
			ran: ranAll(10),
			seconds: null
		});

		const averages = await estimateAveragesForPlaybook(db, playbook);
		expect(averages.avgCreditsPerDocument).toBeCloseTo(2, 10);
		expect(averages.avgSecondsPerDocument).toBeCloseTo(10, 10);
	});
});

// ---------------------------------------------------------------------------------------
// The visible record (#610 item 3): the failure mode to avoid is silence.
// ---------------------------------------------------------------------------------------

describe('estimateAveragesForPlaybook: says out loud when a playbook has run jobs and still has no history', () => {
	it('reports every passed-over job by reason, and warns exactly once', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'cancelled',
			documentCount: 4,
			spentCredits: 8,
			ran: ranAll(2),
			seconds: 40
		});
		await insertJob({
			playbook,
			status: 'failed',
			documentCount: 4,
			spentCredits: 8,
			ran: ranAll(2),
			seconds: 40
		});
		await insertJob({
			playbook,
			status: 'stopped_at_ceiling',
			documentCount: 4,
			spentCredits: 0,
			ran: ranAll(4),
			seconds: 40
		});

		const seen: (PlaybookEstimateBasis & { playbookId: string })[] = [];
		const averages = await estimateAveragesForPlaybook(db, playbook, {
			sink: (entry) => seen.push(entry)
		});

		expect(averages).toMatchObject(UNMEASURED_PLAYBOOK_ESTIMATE);
		expect(averages.basis.source).toBe('cold_start');
		expect([...averages.basis.ignored].sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
			{ reason: 'cancelled', jobs: 1 },
			{ reason: 'failed', jobs: 1 },
			{ reason: 'no_spend', jobs: 1 }
		]);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.playbookId).toBe(playbook);
	});

	it('a genuine first import is silent: nothing was passed over, so there is nothing to say', async () => {
		const seen: unknown[] = [];
		const averages = await estimateAveragesForPlaybook(db, playbookId(), {
			sink: (entry) => seen.push(entry)
		});

		expect(averages.basis.source).toBe('cold_start');
		expect(averages.basis.ignored).toEqual([]);
		expect(seen).toEqual([]);
	});

	it('the history path is silent too', async () => {
		const playbook = playbookId();
		await insertJob({
			playbook,
			status: 'stopped_at_ceiling',
			documentCount: 4,
			spentCredits: 8,
			ran: ranAll(4),
			seconds: 40
		});

		const seen: unknown[] = [];
		const averages = await estimateAveragesForPlaybook(db, playbook, {
			sink: (entry) => seen.push(entry)
		});

		expect(averages.basis.source).toBe('history');
		expect(averages.basis.ignored).toEqual([]);
		expect(seen).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------
// The reproduction (#610's verification): a real ceiling-stopped job through the real
// runner and the real driver, then what the next job of that playbook is quoted.
// ---------------------------------------------------------------------------------------

const stubEmbedRelationLabel: Embedder = async (texts) => texts.map(() => [0, 0, 0]);
const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

// Deliberately expensive per step (a real `cheap` row is 0.25 EUR per input MTok), so a
// mock document costs more than a cold-start constant rather than a thousandth of one.
// This is the synthetic ceiling #610 asked for in preference to spending on a real one:
// what the test needs is a job that settles `stopped_at_ceiling` with a per-document cost
// above the constant, and a real gateway would give the same row for money. Each step of
// the mock reports 10 input and 5 output tokens, so it bills 2 credits.
const TEST_PARAMS = { pricePerInputMTok: 1000, pricePerOutputMTok: 2000, creditsPerEur: 100 };

// Wide enough that `wouldExceedCeiling` never fires: at these prices one step's *worst*
// case is `STEP_MAX_OUTPUT_TOKENS` (24,576) output tokens, about 4,900 credits, and this
// test is about the per-document step ceiling rather than the job-wide credit one. The two
// stops both settle `stopped_at_ceiling` and the whole point of the change is that they are
// treated differently, so the fixture has to pick one on purpose.
const WIDE_BUDGET_CREDITS = 1_000_000;

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

function fixedModelSelector(languageModel: LanguageModel): ModelSelector {
	const resolved: ImportModel = {
		languageModel,
		provider: 'test',
		modelId: 'test-cheap',
		params: TEST_PARAMS
	};
	return { resolve: async () => resolved };
}

function entityStep(id: string, localId: string, name: string, documentId: string) {
	return toolCallStep([
		{
			id,
			name: 'entity_propose',
			input: {
				localId,
				type: 'character',
				name,
				aliases: [],
				summary: `${name} appears in this document.`,
				sourceRef: { documentId },
				evidenceSpan: { start: 0, end: 10 },
				images: []
			}
		}
	]);
}

function finishStep(id: string) {
	return toolCallStep([{ id, name: 'job_finish', input: { outcome: 'completed', summary: '' } }]);
}

describe('the bug itself: a ceiling-stopped job, then the next job of the same playbook (issue #610)', () => {
	it('quotes the second job off the first job real cost instead of off the cold-start constant', async () => {
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });

		// #606's obsidian job in the small: some documents finish, one runs out of steps,
		// and the job settles `stopped_at_ceiling`. `stepBudget: 2` is the synthetic ceiling.
		const playbook = loadPlaybook(`---
id: w610-ceiling
version: 1
name: Ceiling fixture
description: A two-step playbook, so a document that does not finish runs out of steps.
stepBudget: 2
---

Read the document, propose what it names, then finish.

## Inputs

One document.

## Tools

- \`entity_propose\` - propose an entity.
- \`job_finish\` - close the run.

## Steps

1. Propose, then finish.

   \`\`\`json
   { "outcome": "completed" }
   \`\`\`
`);
		const playbookName = playbookId();
		const sources = new InMemorySourceReader({
			files: {
				'notes/a.md': 'Aldric Voss commands the harbour watch.',
				'notes/b.md': 'Sera Voss keeps the reach.'
			}
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbookName,
			playbookVersion: playbook.version,
			artefactPath: 's3://w610/ceiling.zip',
			artefactBytes: 100,
			artefactSha256: 'c'.repeat(64),
			documentCount: 2,
			budgetCredits: WIDE_BUDGET_CREDITS,
			estimate: { documentCount: 2, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 20
		});
		expect(admission.admitted).toBe(true);

		// doc-a proposes then finishes in two steps; doc-b proposes twice and never calls
		// job_finish, so its step ceiling is what ends it.
		const model = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-cheap',
			doGenerate: [
				entityStep('a1', 'ea1', 'Aldric Voss', 'doc-a'),
				finishStep('a2'),
				entityStep('b1', 'eb1', 'Sera Voss', 'doc-b'),
				entityStep('b2', 'eb2', 'Sera Voss the Younger', 'doc-b')
			]
		});
		const params: RunImportJobParams = {
			db,
			driver: new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model)
			}),
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: playbookName,
			userId,
			playbook,
			documents: [
				{ id: 'doc-a', sourcePath: 'notes/a.md' },
				{ id: 'doc-b', sourcePath: 'notes/b.md' }
			],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: WIDE_BUDGET_CREDITS },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		};

		const result = await new ImportJobRunner().run(params);
		expect(result.finalStatus).toBe('stopped_at_ceiling');

		const jobRow = await getImportJob(db, admission.jobId);
		expect(jobRow.status).toBe('stopped_at_ceiling');
		// Four steps at 2 credits each: two for doc-a, two for doc-b before its ceiling.
		expect(jobRow.spentCredits).toBeCloseTo(8, 10);

		// What the estimate screen used to say for the next two-document upload of this
		// playbook: the cold-start row, because the job above installed no history.
		const before = estimateImportJob({
			documentCount: 2,
			avgCreditsPerDocument: UNMEASURED_PLAYBOOK_ESTIMATE.avgCreditsPerDocument,
			avgSecondsPerDocument: UNMEASURED_PLAYBOOK_ESTIMATE.avgSecondsPerDocument
		});

		const averages = await estimateAveragesForPlaybook(db, playbookName);
		const after = estimateImportJob({
			documentCount: 2,
			avgCreditsPerDocument: averages.avgCreditsPerDocument,
			avgSecondsPerDocument: averages.avgSecondsPerDocument
		});

		// Both documents ran, so the whole job is the measurement and its own two documents
		// are the denominator. The two literals are what `docs/loop-cost.md`'s #610 section
		// reports, pinned here rather than left to a reader's arithmetic: the second job used
		// to be quoted 3 for work the first had just billed 8.
		expect(averages.basis.source).toBe('history');
		expect(averages.basis.documentsPooled).toBe(2);
		expect(averages.avgCreditsPerDocument).toBeCloseTo(4, 10);
		expect(before.estimatedCredits).toBe(3);
		expect(after.estimatedCredits).toBe(8);
	});
});
