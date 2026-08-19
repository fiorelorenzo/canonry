import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import {
	asc,
	closeDb,
	createDb,
	eq,
	getBalance,
	getImportJob,
	missingEntitySourceRefsForJob,
	runMigrations,
	type Db
} from '@canonry/db';
import {
	creditTransaction,
	entity,
	entitySourceRef,
	modelCall,
	operationPrice,
	proposal as proposalTable,
	universe,
	user
} from '@canonry/db/schema';
import postgres from 'postgres';
import {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector
} from './gateway-driver.js';
import { loadBuiltinPlaybook, loadPlaybook, type LoadedPlaybook } from './playbook.js';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import {
	acceptImportProposal,
	admitAndCreateImportJob,
	ImportJobRunner,
	parseOutcomeNote,
	type RunImportJobParams
} from './job-runner.js';
import type { SimilarityFn } from './matching.js';
import type { Embedder } from '@canonry/copilot';

// Issue #190: resolveRelationType's semantic rung, stubbed deterministically since
// none of this file's fixtures propose a relation whose label misses rung 1's exact
// match (the one relation_propose call below hits the self-loop guard first and never
// reaches resolveRelationType at all) - same-length zero vectors keep cosineSimilarity
// well-defined (0, not NaN) for any input length, in case that ever changes.
const stubEmbedRelationLabel: Embedder = async (texts) => texts.map(() => [0, 0, 0]);

function createHashOf(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

const suffix = process.env.TEST_DB_SUFFIX ?? 'jobrunner-local';
const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_jr_${suffix}`;

// issue #126, SPEC.md §17: the same hand-authored bilingual fixture
// bilingual-import.test.ts drives the real archive loader with, reused here (real
// files off disk, not re-typed inline) to prove the language survives all the way into
// a real `proposal.patch` row, not just the in-memory JobEvent stream.
const BILINGUAL_FIXTURE_ROOT = fileURLToPath(
	new URL('../test/fixtures/bilingual/', import.meta.url)
);
const EN_PATH = 'handout-en.md';
const IT_PATH = 'racconto-it.md';

async function migrateFreshDatabase(): Promise<void> {
	const target = new URL(TEST_DATABASE_URL);
	const dbName = target.pathname.replace(/^\//, '');
	const adminUrl = new URL(TEST_DATABASE_URL);
	adminUrl.pathname = '/postgres';
	const admin = postgres(adminUrl.toString(), { max: 1 });
	try {
		await admin.unsafe(
			'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
			[dbName]
		);
		await admin.unsafe(`drop database if exists "${dbName}"`);
		await admin.unsafe(`create database "${dbName}"`);
	} finally {
		await admin.end();
	}
	const migrator = createDb(TEST_DATABASE_URL, { max: 1 });
	try {
		await runMigrations(migrator);
	} finally {
		await closeDb(migrator);
	}
}

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

function scriptedModel(steps: ReturnType<typeof toolCallStep>[]): MockLanguageModelV4 {
	return new MockLanguageModelV4({ provider: 'test', modelId: 'test-cheap', doGenerate: steps });
}

const TEST_PARAMS = { pricePerInputMTok: 1, pricePerOutputMTok: 2, creditsPerEur: 100 };
const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

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
				evidenceSpan: { start: 0, end: 10 }
			}
		}
	]);
}

function patchName(patch: unknown): string | undefined {
	if (patch && typeof patch === 'object' && 'name' in patch && typeof patch.name === 'string') {
		return patch.name;
	}
	return undefined;
}

function patchLanguage(patch: unknown): string | null | undefined {
	if (patch && typeof patch === 'object' && 'language' in patch) {
		if (typeof patch.language === 'string' || patch.language === null) return patch.language;
	}
	return undefined;
}

function patchBody(patch: unknown): string | undefined {
	if (patch && typeof patch === 'object') {
		if ('body' in patch && typeof patch.body === 'string') return patch.body;
		if ('after' in patch && typeof patch.after === 'string') return patch.after;
	}
	return undefined;
}

function finishStep(id: string) {
	return toolCallStep([{ id, name: 'job_finish', input: { outcome: 'completed' } }]);
}

describe('ImportJobRunner (issues #26, #27, #30, #36)', () => {
	let db: Db;

	beforeAll(async () => {
		await migrateFreshDatabase();
		db = createDb(TEST_DATABASE_URL, { max: 5 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function priceFixture() {
		await db
			.insert(operationPrice)
			.values({
				operation: 'import.document',
				label: 'Import extraction per document',
				credits: 1,
				kind: 'import'
			})
			.onConflictDoNothing({ target: operationPrice.operation });
	}

	async function userAndUniverse() {
		const userId = `runner-user-${randomUUID().slice(0, 8)}`;
		await db.insert(user).values({
			id: userId,
			name: 'Runner Test',
			email: `${userId}@canonry.invalid`,
			emailVerified: true
		});
		const [u] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Runner World',
				slug: `runner-world-${randomUUID().slice(0, 8)}`,
				kind: 'homebrew'
			})
			.returning();
		if (!u) throw new Error('fixture failed');
		return { userId, universeId: u.id };
	}

	it('running the same fixture export twice produces zero new proposals the second time (issue #36 - the blunt acceptance test)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = await loadBuiltinPlaybook('generic');
		const sources = new InMemorySourceReader({
			files: { 'notes/aldric.md': 'Aldric Voss commands the harbour watch.' }
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/aldric.zip',
			artefactBytes: 100,
			artefactSha256: 'x'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});
		expect(admission.admitted).toBe(true);

		const runner = new ImportJobRunner();
		const baseParams: Omit<RunImportJobParams, 'driver'> = {
			db,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-1', sourcePath: 'notes/aldric.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		};

		const model1 = scriptedModel([
			toolCallStep([{ id: 'r1', name: 'source_read', input: { path: 'notes/aldric.md' } }]),
			entityStep('r2', 'e1', 'Aldric Voss', 'doc-1'),
			finishStep('r3')
		]);
		const driver1 = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model1)
		});
		const firstRun = await runner.run({ ...baseParams, driver: driver1 });

		expect(firstRun.finalStatus).toBe('finished');
		expect(firstRun.proposalsEmitted).toBe(1);

		const jobAfterFirst = await getImportJob(db, admission.jobId);
		expect(jobAfterFirst.status).toBe('finished');
		expect(parseOutcomeNote(jobAfterFirst.outcomeNote)).toEqual({
			v: 1,
			kind: 'finished',
			documents: 1,
			proposals: 1
		});

		// Simulate the GM reviewing and accepting the proposal - this is what actually
		// creates the entity and its entity_source_ref (SPEC.md §6.4 step 1 only ever
		// matches against entities that exist, and nothing exists until a human accepts).
		const [createdProposal] = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		if (!createdProposal) throw new Error('expected one proposal from the first run');
		const contentHash = createHashOf('Aldric Voss commands the harbour watch.');
		await acceptImportProposal(db, {
			proposalId: createdProposal.id,
			sourceSystem: 'obsidian',
			externalId: 'notes/aldric.md',
			sourceUrl: null,
			contentHash,
			importJobId: admission.jobId
		});

		// Second import of the identical export: a fresh job, same content, same source
		// path. The model would propose the same entity again if it ran - it must never
		// get the chance to.
		const admission2 = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/aldric.zip',
			artefactBytes: 100,
			artefactSha256: 'x'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		const model2 = scriptedModel([finishStep('never')]);
		const driver2 = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model2)
		});
		const secondRun = await runner.run({
			...baseParams,
			dbJobId: admission2.jobId,
			driver: driver2
		});

		expect(secondRun.finalStatus).toBe('finished');
		expect(secondRun.proposalsEmitted).toBe(0);
		expect(secondRun.documents).toEqual([
			{
				documentId: 'doc-1',
				sourcePath: 'notes/aldric.md',
				status: 'skipped_unchanged',
				entityCount: 0,
				relationCount: 0,
				proposalsCreated: 0,
				lostToolCallCount: 0,
				detail: 'unchanged since the last import'
			}
		]);
		// The model was never even called for the second job.
		expect(model2.doGenerateCalls).toHaveLength(0);
	});

	it("routes a proposal's rationale through the reader's locale (issue #263) - stored on proposal.locale too", async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = await loadBuiltinPlaybook('generic');
		const sources = new InMemorySourceReader({
			files: { 'notes/millbrook.md': 'Millbrook is a quiet river town.' }
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/millbrook.zip',
			artefactBytes: 100,
			artefactSha256: 'y'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});
		expect(admission.admitted).toBe(true);

		const model = scriptedModel([
			toolCallStep([{ id: 'r1', name: 'source_read', input: { path: 'notes/millbrook.md' } }]),
			entityStep('r2', 'e1', 'Millbrook', 'doc-1'),
			finishStep('r3')
		]);
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();
		await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-1', sourcePath: 'notes/millbrook.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000,
			locale: 'it'
		});

		const [row] = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		if (!row) throw new Error('expected one proposal');
		expect(row.rationale).toBe('Estratto da "notes/millbrook.md" come nuova voce.');
		expect(row.locale).toBe('it');
	});

	it('writes one model_call row per model call, agent import, and points the document charge at one of them without charging twice (issue #133)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = await loadBuiltinPlaybook('generic');
		const sources = new InMemorySourceReader({
			files: { 'notes/aldric.md': 'Aldric Voss commands the harbour watch.' }
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/aldric.zip',
			artefactBytes: 100,
			artefactSha256: 'x'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});
		expect(admission.admitted).toBe(true);

		const balanceBefore = await getBalance(db, userId);

		const model = scriptedModel([
			toolCallStep([{ id: 'm1', name: 'source_read', input: { path: 'notes/aldric.md' } }]),
			entityStep('m2', 'e1', 'Aldric Voss', 'doc-1'),
			finishStep('m3')
		]);
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});

		const runner = new ImportJobRunner();
		const run = await runner.run({
			db,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-1', sourcePath: 'notes/aldric.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000,
			driver
		});

		expect(run.finalStatus).toBe('finished');
		expect(run.proposalsEmitted).toBe(1);

		// One model_call row per model call - three scripted steps, three real calls
		// (source_read, the entity proposal, job_finish), never aggregated per document
		// or per job.
		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.userId, userId))
			.orderBy(asc(modelCall.createdAt));
		expect(calls).toHaveLength(3);
		for (const call of calls) {
			expect(call.agent).toBe('import');
			// The step-identifying operation - the generic playbook's own modelPurpose,
			// never escalated in this fixture.
			expect(call.operation).toBe('import.cheap');
			expect(call.inputTokens).toBe(10);
			expect(call.outputTokens).toBe(5);
			// Never charged per call - the flat per-document price below is the only real
			// spend, so a row here never doubles it.
			expect(call.credits).toBe(0);
			// Real cost to us, computed through @canonry/ai's computeCost from the same
			// TEST_PARAMS every step ran under - never zero, unlike credits above.
			expect(call.costEur).toBeGreaterThan(0);
			expect(call.latencyMs).toBeGreaterThanOrEqual(0);
		}

		// The document's one real charge: still the flat import.document price (the
		// seeded operation_price row - migration 0004's real catalogue value takes
		// precedence over priceFixture's onConflictDoNothing insert), still exactly
		// once, but now pointing at a real model_call row instead of leaving
		// model_call_id null.
		const [documentPrice] = await db
			.select()
			.from(operationPrice)
			.where(eq(operationPrice.operation, 'import.document'));
		if (!documentPrice) throw new Error('expected import.document to be priced');
		const spends = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.userId, userId));
		expect(spends).toHaveLength(1);
		const spend = spends[0];
		if (!spend) throw new Error('expected one credit_transaction row');
		expect(spend.kind).toBe('spend');
		expect(spend.operation).toBe('import.document');
		expect(spend.credits).toBeCloseTo(-documentPrice.credits, 6);
		expect(spend.modelCallId).not.toBeNull();
		expect(calls.map((call) => call.id)).toContain(spend.modelCallId);

		// The total the user actually pays is unchanged from before this issue: exactly
		// the flat per-document price, not the sum of the three calls' real (much
		// smaller) per-token cost - proof nobody pays twice.
		const balanceAfter = await getBalance(db, userId);
		expect(balanceBefore.subscriptionCredits - balanceAfter.subscriptionCredits).toBeCloseTo(
			documentPrice.credits,
			6
		);
		const realCallCostCredits = calls.reduce((sum, call) => sum + call.costEur, 0) * 100;
		expect(realCallCostCredits).toBeGreaterThan(0);
		expect(realCallCostCredits).toBeLessThan(documentPrice.credits);
	});

	it('stops cleanly at stopped_at_ceiling with its proposals intact, then resumes and finishes the remaining document', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = await loadBuiltinPlaybook('generic');
		const sources = new InMemorySourceReader({
			files: {
				'notes/a.md': 'Entity A lives here.',
				'notes/b.md': 'Entity B lives here.'
			}
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/two-docs.zip',
			artefactBytes: 100,
			artefactSha256: 'y'.repeat(64),
			documentCount: 2,
			budgetCredits: 1000,
			estimate: { documentCount: 2, estimatedMinutes: 1, estimatedCredits: 20 },
			concurrencyLimit: 5
		});

		const runner = new ImportJobRunner();
		const documents = [
			{ id: 'doc-a', sourcePath: 'notes/a.md' },
			{ id: 'doc-b', sourcePath: 'notes/b.md' }
		];
		const paramsBase: Omit<RunImportJobParams, 'driver' | 'budget'> = {
			db,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents,
			sources,
			images: new InMemoryImageStore(),
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		};

		const modelA = scriptedModel([entityStep('a1', 'ea', 'Entity A', 'doc-a')]);
		const driverA = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(modelA)
		});
		// issue #134: the ceiling now prices a step's worst case (known input plus
		// gateway-driver.ts's STEP_MAX_OUTPUT_TOKENS-capped output) before starting it, so
		// against the real 'generic' playbook one step's worst case already exceeds a
		// credit - 0.5 cannot fit a second step from either document. Every job's first
		// step still gets one grace attempt regardless of how tiny the budget is (the
		// reservation issue #134 also adds, toward a first proposal), which is what lets
		// document A's one entity_propose step run before the ceiling closes on everything
		// after it, document B's own first step included.
		const firstRun = await runner.run({
			...paramsBase,
			driver: driverA,
			budget: { maxCredits: 0.5 }
		});

		expect(firstRun.finalStatus).toBe('stopped_at_ceiling');
		// Document A's own next step (job_finish) never started either - the model was
		// asked for exactly the one step that fit.
		expect(modelA.doGenerateCalls).toHaveLength(1);

		const proposalsAfterCeiling = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		expect(proposalsAfterCeiling.length).toBeGreaterThanOrEqual(1);
		expect(proposalsAfterCeiling.some((p) => patchName(p.patch) === 'Entity A')).toBe(true);

		const jobAfterCeiling = await getImportJob(db, admission.jobId);
		expect(jobAfterCeiling.status).toBe('stopped_at_ceiling');
		// doc-a's own ceiling event carries the real detail; doc-b never even started
		// (gateway-driver.ts's outer loop budget check, before runDocument), named rather
		// than silently dropped - "prefer naming the first and saying how many others"
		// (issue #177).
		expect(parseOutcomeNote(jobAfterCeiling.outcomeNote)).toEqual({
			v: 1,
			kind: 'offender',
			offender: { path: 'notes/a.md', reason: 'step_worst_case_exceeds_budget', othersCount: 1 }
		});

		// Resume: same job id, a real budget this time. Neither document reached
		// `finished` in the first run, so both are still in `documentsToRun` - document A
		// picks back up where it stopped (closing out with nothing new to add) and
		// document B runs for the first time.
		const modelB = scriptedModel([
			finishStep('a2'),
			toolCallStep([{ id: 'b1', name: 'source_read', input: { path: 'notes/b.md' } }]),
			entityStep('b2', 'eb', 'Entity B', 'doc-b'),
			finishStep('b3')
		]);
		const driverB = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(modelB)
		});
		const resumed = await runner.run({
			...paramsBase,
			driver: driverB,
			budget: { maxCredits: 1000 }
		});

		expect(resumed.finalStatus).toBe('finished');
		expect(resumed.documents.map((d) => d.documentId)).toEqual(['doc-a', 'doc-b']);
		// Document A's resumed step closes it out without proposing anything new; only
		// document B's entity_propose is new this run.
		expect(resumed.proposalsEmitted).toBe(1);

		const jobAfterResume = await getImportJob(db, admission.jobId);
		expect(jobAfterResume.status).toBe('finished');

		const allProposals = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		expect(allProposals.some((p) => patchName(p.patch) === 'Entity A')).toBe(true);
		expect(allProposals.some((p) => patchName(p.patch) === 'Entity B')).toBe(true);
	});

	it('cancel stops the job mid-document, leaving already-emitted proposals intact and settling as cancelled', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = await loadBuiltinPlaybook('generic');
		const sources = new InMemorySourceReader({ files: { 'notes/c.md': 'Entity C lives here.' } });

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/one-doc.zip',
			artefactBytes: 50,
			artefactSha256: 'z'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		const model = scriptedModel([
			toolCallStep([{ id: 'c1', name: 'source_read', input: { path: 'notes/c.md' } }]),
			entityStep('c2', 'ec', 'Entity C', 'doc-c'),
			// A third step the cancel should prevent from ever running.
			finishStep('c3')
		]);
		const runner = new ImportJobRunner();

		// Cancel deterministically between steps rather than racing a timer: GatewayDriver
		// checks the abort signal at the *top* of every step, before resolving a model for
		// that step, so cancelling while resolving the model for step 2 (source_read
		// already ran) guarantees step 3 (job_finish) never starts - genuinely mid-document,
		// not between documents.
		let resolvedSteps = 0;
		let cancellingDriver: GatewayDriver;
		const cancellingSelector: ModelSelector = {
			resolve: async (purpose) => {
				resolvedSteps += 1;
				if (resolvedSteps === 2) cancellingDriver.cancel(admission.jobId);
				return fixedModelSelector(model).resolve(purpose);
			}
		};
		cancellingDriver = new GatewayDriver({ gateway: IDENTITY_GATEWAY, models: cancellingSelector });

		const result = await runner.run({
			db,
			driver: cancellingDriver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-c', sourcePath: 'notes/c.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('cancelled');
		expect(result.documents[0]?.status).toBe('cancelled');
		// The entity proposed in step 2 (before cancellation) is intact; job_finish (step
		// 3) never ran.
		expect(model.doGenerateCalls).toHaveLength(2);

		const jobRow = await getImportJob(db, admission.jobId);
		expect(jobRow.status).toBe('cancelled');
		expect(parseOutcomeNote(jobRow.outcomeNote)).toEqual({
			v: 1,
			kind: 'offender',
			offender: { path: 'notes/c.md', reason: 'cancelled_before_step', othersCount: 0 }
		});
	});

	it('names the document and its detail in outcome_note when a document hits its own step ceiling (issue #177)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = loadPlaybook(`---
id: fixture
version: 1
name: Fixture
description: A playbook with a tiny step ceiling, for the outcome_note step-ceiling test.
stepBudget: 2
---

Read the document, propose whatever you find, then finish.

## Inputs

One document.

## Tools

- \`source_read\` - read the document.
- \`entity_propose\` - propose an entity.
- \`job_finish\` - close the run.

## Steps

1. Propose entities forever.

   \`\`\`json
   { "outcome": "completed" }
   \`\`\`
`);
		const sources = new InMemorySourceReader({ files: { 'notes/d.md': 'Entity D lives here.' } });

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/one-doc.zip',
			artefactBytes: 50,
			artefactSha256: 'd'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		// Never calls job_finish - the step ceiling, not the model, has to stop it.
		const model = scriptedModel([
			entityStep('s1', 'ed1', 'Entity D1', 'doc-d'),
			entityStep('s2', 'ed2', 'Entity D2', 'doc-d')
		]);
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();

		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-d', sourcePath: 'notes/d.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('stopped_at_ceiling');
		expect(model.doGenerateCalls).toHaveLength(2);

		const jobRow = await getImportJob(db, admission.jobId);
		expect(parseOutcomeNote(jobRow.outcomeNote)).toEqual({
			v: 1,
			kind: 'offender',
			offender: { path: 'notes/d.md', reason: 'step_ceiling', othersCount: 0 }
		});
	});

	it('names the document and its detail in outcome_note when a document is ended for looping (issue #169)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = loadPlaybook(`---
id: fixture
version: 1
name: Fixture
description: A playbook with a generous step ceiling, for the outcome_note loop test.
stepBudget: 20
---

Read the document, list its siblings, then finish.

## Inputs

One document.

## Tools

- \`source_list\` - list files under a path.
- \`job_finish\` - close the run.

## Steps

1. List the export root, then finish.

   \`\`\`json
   { "outcome": "completed" }
   \`\`\`
`);
		const sources = new InMemorySourceReader({ files: { 'notes/e.md': 'irrelevant text' } });

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/one-doc.zip',
			artefactBytes: 50,
			artefactSha256: 'e'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		let calls = 0;
		const model = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-cheap',
			// A model stuck calling source_list with the same argument, never finishing -
			// the loop guard (issue #169) has to end the document long before the 20-step
			// ceiling.
			doGenerate: async () => {
				calls += 1;
				return toolCallStep([{ id: `t${calls}`, name: 'source_list', input: { path: '' } }]);
			}
		});
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();

		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-e', sourcePath: 'notes/e.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('stopped_at_ceiling');
		expect(calls).toBe(4);

		const jobRow = await getImportJob(db, admission.jobId);
		expect(parseOutcomeNote(jobRow.outcomeNote)).toEqual({
			v: 1,
			kind: 'offender',
			offender: {
				path: 'notes/e.md',
				reason: 'loop_guard',
				othersCount: 0,
				toolName: 'source_list',
				loopCount: 4
			}
		});
	});

	it('names the document and its detail in outcome_note when a document fails (issue #134 truncated output)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = loadPlaybook(`---
id: fixture
version: 1
name: Fixture
description: A playbook for the outcome_note failed-document test.
stepBudget: 5
---

Propose one entity then finish.

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
		const sources = new InMemorySourceReader({ files: { 'notes/f.md': 'irrelevant text' } });

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/one-doc.zip',
			artefactBytes: 50,
			artefactSha256: 'f'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		// A response generateText cannot parse against entity_propose's schema - the same
		// shape a real truncated-mid-JSON call would take (issue #134's
		// STEP_MAX_OUTPUT_TOKENS cutting the model off before the closing brace).
		const model = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-cheap',
			doGenerate: async () => ({
				content: [
					{
						type: 'tool-call' as const,
						toolCallId: 't1',
						toolName: 'entity_propose',
						input: '{"localId":"e1","type":"character","name":"Trunc'
					}
				],
				finishReason: { unified: 'length' as const, raw: undefined },
				usage: usage(10, 8192),
				warnings: []
			})
		});
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();

		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-f', sourcePath: 'notes/f.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('failed');
		// issue #273: one original attempt plus STEP_PARSE_RETRY_LIMIT (3) retries, each
		// asking for less and each a real, charged model call - this mock never varies, so
		// every one of them fails the same way and the document only gives up once all
		// four have run.
		expect(model.doGenerateCalls).toHaveLength(4);

		const jobRow = await getImportJob(db, admission.jobId);
		expect(parseOutcomeNote(jobRow.outcomeNote)).toEqual({
			v: 1,
			kind: 'offender',
			offender: { path: 'notes/f.md', reason: 'tool_calls_unparseable', othersCount: 0 }
		});
	});

	it('retries a step whose tool calls are all invalid, lets the document finish once the retry succeeds, and writes one model_call row per attempt including the retry (issue #273)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = loadPlaybook(`---
id: fixture
version: 1
name: Fixture
description: A playbook for the issue #273 retry-then-succeed test.
stepBudget: 5
---

Propose one entity then finish.

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
		const sources = new InMemorySourceReader({ files: { 'notes/h.md': 'irrelevant text' } });

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/one-doc.zip',
			artefactBytes: 50,
			artefactSha256: 'h'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		// First attempt: every tool call fails to parse, same shape as the failing test
		// above. Second attempt (the retry): a real, schema-valid entity_propose. Third:
		// job_finish.
		let calls = 0;
		const model = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-cheap',
			doGenerate: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						content: [
							{
								type: 'tool-call' as const,
								toolCallId: 't1',
								toolName: 'entity_propose',
								input: '{"localId":"e1","type":"character","name":"Trunc'
							}
						],
						finishReason: { unified: 'length' as const, raw: undefined },
						usage: usage(10, 8192),
						warnings: []
					};
				}
				if (calls === 2) {
					return entityStep('t2', 'e1', 'Entity Rescued By Retry', 'doc-h');
				}
				return toolCallStep([{ id: 't3', name: 'job_finish', input: { outcome: 'completed' } }]);
			}
		});
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();

		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-h', sourcePath: 'notes/h.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('finished');
		expect(result.proposalsEmitted).toBe(1);
		expect(model.doGenerateCalls).toHaveLength(3);

		// issue #273: every attempt is a real model call - the failed one and the retry
		// that rescued it both wrote their own model_call row, exactly like the ordinary
		// third step did. None of them charged credits directly (the flat per-document
		// price below is the only real spend), but every one priced a real cost.
		const calls_ = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.userId, userId))
			.orderBy(asc(modelCall.createdAt));
		expect(calls_).toHaveLength(3);
		for (const row of calls_) {
			expect(row.agent).toBe('import');
			expect(row.credits).toBe(0);
			expect(row.costEur).toBeGreaterThan(0);
		}

		// The document's proposal, from the retry that rescued the step, still landed and
		// was still charged exactly once, the same as any clean run.
		const proposalRows = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		expect(proposalRows).toHaveLength(1);
		const transactions = await db
			.select()
			.from(creditTransaction)
			.where(eq(creditTransaction.userId, userId));
		expect(transactions.filter((t) => t.operation === 'import.document')).toHaveLength(1);
	});

	it('keeps the valid proposal, reaches the job as an event, and names the loss in outcome_note when a step is only partly truncated (issue #212)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = loadPlaybook(`---
id: fixture
version: 1
name: Fixture
description: A playbook for the outcome_note partial-loss test.
stepBudget: 5
---

Propose entities then finish.

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
		const sources = new InMemorySourceReader({ files: { 'notes/g.md': 'irrelevant text' } });

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/one-doc.zip',
			artefactBytes: 50,
			artefactSha256: 'g'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});

		// One step, two entity_propose calls: the first genuinely malformed (the same
		// truncated-mid-JSON shape issue #134 uses for the total-loss case), the second a
		// real, schema-valid call. `generateText` skips the invalid one rather than
		// throwing, so this is not a mocked "invalid" flag - it is a response the AI SDK
		// itself cannot parse.
		let calls = 0;
		const model = new MockLanguageModelV4({
			provider: 'test',
			modelId: 'test-cheap',
			doGenerate: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						content: [
							{
								type: 'tool-call' as const,
								toolCallId: 'bad1',
								toolName: 'entity_propose',
								input: '{"localId":"e1","type":"character","name":"Trunc'
							},
							{
								type: 'tool-call' as const,
								toolCallId: 'ok1',
								toolName: 'entity_propose',
								input: JSON.stringify({
									localId: 'e2',
									type: 'character',
									name: 'Survives Truncation',
									aliases: [],
									summary: 'The one call in this step that parsed.',
									sourceRef: { documentId: 'doc-g' },
									evidenceSpan: { start: 0, end: 5 }
								})
							}
						],
						finishReason: { unified: 'length' as const, raw: undefined },
						usage: usage(10, 8192),
						warnings: []
					};
				}
				return toolCallStep([{ id: 't2', name: 'job_finish', input: { outcome: 'completed' } }]);
			}
		});
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();

		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-g', sourcePath: 'notes/g.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		// The document still finishes and its valid proposal still lands - the loss did
		// not turn into a failure.
		expect(result.finalStatus).toBe('finished');
		expect(result.proposalsEmitted).toBe(1);
		expect(result.documents).toMatchObject([{ documentId: 'doc-g', lostToolCallCount: 1 }]);

		const rows = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		expect(rows).toHaveLength(1);
		expect(patchName(rows[0]?.patch)).toBe('Survives Truncation');

		// What a GM reads: never a bare "finished" that reassures past a real loss.
		const jobRow = await getImportJob(db, admission.jobId);
		expect(parseOutcomeNote(jobRow.outcomeNote)).toEqual({
			v: 1,
			kind: 'finished',
			documents: 1,
			proposals: 1,
			lossy: { path: 'notes/g.md', count: 1, othersCount: 0 }
		});
	});

	it("carries each document's own detected language into the persisted proposal, and preserves the untranslated proper noun in the Italian summary (issue #126, SPEC.md §17)", async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const playbook = await loadBuiltinPlaybook('generic');

		const enContent = await readFile(`${BILINGUAL_FIXTURE_ROOT}${EN_PATH}`, 'utf8');
		const itContent = await readFile(`${BILINGUAL_FIXTURE_ROOT}${IT_PATH}`, 'utf8');
		const sources = new InMemorySourceReader({
			files: { [EN_PATH]: enContent, [IT_PATH]: itContent }
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'generic',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/bilingual.zip',
			artefactBytes: 200,
			artefactSha256: 'b'.repeat(64),
			documentCount: 2,
			budgetCredits: 1000,
			estimate: { documentCount: 2, estimatedMinutes: 1, estimatedCredits: 20 },
			concurrencyLimit: 5
		});
		expect(admission.admitted).toBe(true);

		const gildedRatSummary =
			'The busiest tavern in Port Verity, run by Mirella Fenn for eleven years.';
		const aldricSummary =
			'Non risponde a nessuno tranne il capitano del porto. Lo si trova ogni sera ' +
			'nella locanda conosciuta come The Gilded Rat.';

		const model = scriptedModel([
			toolCallStep([{ id: 'e1', name: 'source_read', input: { path: EN_PATH } }]),
			toolCallStep([
				{
					id: 'e2',
					name: 'entity_propose',
					input: {
						localId: 'place-1',
						type: 'place',
						name: 'The Gilded Rat',
						aliases: [],
						summary: gildedRatSummary,
						sourceRef: { documentId: 'doc-en' },
						evidenceSpan: { start: 0, end: 10 },
						images: []
					}
				}
			]),
			finishStep('e3'),
			toolCallStep([{ id: 'i1', name: 'source_read', input: { path: IT_PATH } }]),
			toolCallStep([
				{
					id: 'i2',
					name: 'entity_propose',
					input: {
						localId: 'char-2',
						type: 'character',
						name: 'Capitano Aldric Voss',
						aliases: [],
						summary: aldricSummary,
						sourceRef: { documentId: 'doc-it' },
						evidenceSpan: { start: 0, end: 10 },
						images: []
					}
				}
			]),
			finishStep('i3')
		]);

		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const runner = new ImportJobRunner();
		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'generic',
			userId,
			playbook,
			documents: [
				{ id: 'doc-en', sourcePath: EN_PATH },
				{ id: 'doc-it', sourcePath: IT_PATH }
			],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: () => 0,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('finished');
		expect(result.proposalsEmitted).toBe(2);

		const rows = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		expect(rows).toHaveLength(2);

		const gildedRatRow = rows.find((r) => patchName(r.patch) === 'The Gilded Rat');
		const aldricRow = rows.find((r) => patchName(r.patch) === 'Capitano Aldric Voss');
		if (!gildedRatRow || !aldricRow) throw new Error('expected both proposals to persist');

		// The language the driver's per-document detection stamped onto each entity
		// survives all the way into the real proposal.patch column, quoted here from the
		// actual rows read back from Postgres rather than the in-memory payload.
		expect(patchLanguage(gildedRatRow.patch)).toBe('en');
		expect(patchLanguage(aldricRow.patch)).toBe('it');

		// The proper noun "The Gilded Rat" survives untranslated inside the Italian
		// proposal's own body, read back from that same real row.
		const aldricBody = patchBody(aldricRow.patch);
		expect(aldricBody).toContain('The Gilded Rat');
		expect(aldricBody).not.toContain('Ratto Dorato');

		// The loop closes: accepting each proposal (issue #122's acceptProposal, via
		// languageFromAcceptedPatch) prefers this per-document signal over re-detecting
		// from the merged body, so the real entity.language a GM would see matches the
		// document its proposal came from, not just the intermediate proposal row.
		await acceptImportProposal(db, {
			proposalId: gildedRatRow.id,
			sourceSystem: 'generic',
			externalId: EN_PATH,
			sourceUrl: null,
			contentHash: createHashOf(enContent),
			importJobId: admission.jobId
		});
		await acceptImportProposal(db, {
			proposalId: aldricRow.id,
			sourceSystem: 'generic',
			externalId: IT_PATH,
			sourceUrl: null,
			contentHash: createHashOf(itContent),
			importJobId: admission.jobId
		});

		const entityRows = await db.select().from(entity).where(eq(entity.universeId, universeId));
		const gildedRatEntity = entityRows.find((e) => e.name === 'The Gilded Rat');
		const aldricEntity = entityRows.find((e) => e.name === 'Capitano Aldric Voss');
		if (!gildedRatEntity || !aldricEntity) throw new Error('expected both entities to be created');

		expect(gildedRatEntity.language).toBe('en');
		expect(gildedRatEntity.languageSource).toBe('detected');
		expect(aldricEntity.language).toBe('it');
		expect(aldricEntity.languageSource).toBe('detected');
		expect(aldricEntity.body).toContain('The Gilded Rat');
		expect(aldricEntity.body).not.toContain('Ratto Dorato');
	});

	describe("the merge engine sees this job's own pending proposals (issue #160)", () => {
		// A similarity function that only ever agrees with itself on an exact name match -
		// deliberately dumber than the real embedding call, so a "match" in these tests can
		// only come from the two documents naming the entity identically, never from an
		// accidental token-overlap false positive.
		const exactNameSimilarity: SimilarityFn = (subject, candidate) =>
			subject.name === candidate.name ? 1 : 0;
		const MATCH_THRESHOLDS = { matchAbove: 0.85, newBelow: 0.5 } as const;

		it('two documents naming the same entity fold into one proposal, not two colliding creates', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const sources = new InMemorySourceReader({
				files: {
					'notes/a.md': 'Aldric Vane commands the harbour watch.',
					'notes/b.md': 'Aldric Vane also patrols the docks at night.'
				}
			});

			const admission = await admitAndCreateImportJob(db, {
				universeId,
				createdBy: userId,
				sourceType: 'obsidian',
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: 's3://fixtures/aldric-twice.zip',
				artefactBytes: 100,
				artefactSha256: 'f'.repeat(64),
				documentCount: 2,
				budgetCredits: 1000,
				estimate: { documentCount: 2, estimatedMinutes: 1, estimatedCredits: 20 },
				concurrencyLimit: 5
			});
			expect(admission.admitted).toBe(true);

			const model = scriptedModel([
				toolCallStep([{ id: 'a1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('a2', 'ea', 'Aldric Vane', 'doc-a'),
				finishStep('a3'),
				toolCallStep([{ id: 'b1', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('b2', 'eb', 'Aldric Vane', 'doc-b'),
				finishStep('b3')
			]);
			const driver = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model)
			});

			const runner = new ImportJobRunner();
			const result = await runner.run({
				db,
				driver,
				dbJobId: admission.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [
					{ id: 'doc-a', sourcePath: 'notes/a.md' },
					{ id: 'doc-b', sourcePath: 'notes/b.md' }
				],
				sources,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: exactNameSimilarity,
				thresholds: MATCH_THRESHOLDS,
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000
			});

			expect(result.finalStatus).toBe('finished');
			// Without the fix this is 2: one `create` proposal per document, both named
			// "Aldric Vane", the second colliding with the first on
			// `entity_universe_slug_key` the moment anyone tries to accept it.
			expect(result.proposalsEmitted).toBe(1);

			const rows = await db
				.select()
				.from(proposalTable)
				.where(eq(proposalTable.universeId, universeId));
			expect(rows).toHaveLength(1);
			expect(rows[0]?.kind).toBe('create');
			expect(patchName(rows[0]?.patch)).toBe('Aldric Vane');
		});

		it('accepting the proposals from both documents in sequence does not throw', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const docAContent = 'Aldric Vane commands the harbour watch.';
			const docBContent = 'Aldric Vane also patrols the docks at night.';
			const sources = new InMemorySourceReader({
				files: { 'notes/a.md': docAContent, 'notes/b.md': docBContent }
			});

			const admission = await admitAndCreateImportJob(db, {
				universeId,
				createdBy: userId,
				sourceType: 'obsidian',
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: 's3://fixtures/aldric-twice-accept.zip',
				artefactBytes: 100,
				artefactSha256: 'g'.repeat(64),
				documentCount: 2,
				budgetCredits: 1000,
				estimate: { documentCount: 2, estimatedMinutes: 1, estimatedCredits: 20 },
				concurrencyLimit: 5
			});

			const model = scriptedModel([
				toolCallStep([{ id: 'c1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('c2', 'ea', 'Aldric Vane', 'doc-a'),
				finishStep('c3'),
				toolCallStep([{ id: 'c4', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('c5', 'eb', 'Aldric Vane', 'doc-b'),
				finishStep('c6')
			]);
			const driver = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model)
			});

			const runner = new ImportJobRunner();
			const result = await runner.run({
				db,
				driver,
				dbJobId: admission.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [
					{ id: 'doc-a', sourcePath: 'notes/a.md' },
					{ id: 'doc-b', sourcePath: 'notes/b.md' }
				],
				sources,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: exactNameSimilarity,
				thresholds: MATCH_THRESHOLDS,
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000
			});
			expect(result.finalStatus).toBe('finished');

			const rows = await db
				.select()
				.from(proposalTable)
				.where(eq(proposalTable.universeId, universeId));

			// Without the fix, `rows` has two colliding `create` proposals here and the
			// second of these awaits throws a raw DrizzleQueryError on
			// entity_universe_slug_key - a GM's second accept click turning into a 500.
			for (const row of rows) {
				await expect(
					acceptImportProposal(db, {
						proposalId: row.id,
						sourceSystem: 'obsidian',
						externalId: row.kind === 'create' ? 'notes/a.md' : 'notes/b.md',
						sourceUrl: null,
						contentHash: createHashOf(docAContent),
						importJobId: admission.jobId
					})
				).resolves.not.toThrow();
			}

			const createdEntities = await db
				.select()
				.from(entity)
				.where(eq(entity.universeId, universeId));
			expect(createdEntities.filter((e) => e.name === 'Aldric Vane')).toHaveLength(1);
		});
	});

	it('a relation whose endpoints resolve to the same entity is never proposed (issue #160)', async () => {
		await priceFixture();
		const { userId, universeId } = await userAndUniverse();
		const [existingEntity] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Aldric Vane',
				slug: `aldric-vane-${randomUUID().slice(0, 8)}`,
				body: 'Commands the harbour watch.'
			})
			.returning();
		if (!existingEntity) throw new Error('fixture setup failed');

		const playbook = await loadBuiltinPlaybook('generic');
		const sources = new InMemorySourceReader({
			files: { 'notes/duplicate.md': 'Aldric Vane reports to Aldric Vane, oddly enough.' }
		});

		const admission = await admitAndCreateImportJob(db, {
			universeId,
			createdBy: userId,
			sourceType: 'obsidian',
			playbook: playbook.id,
			playbookVersion: playbook.version,
			artefactPath: 's3://fixtures/self-relation.zip',
			artefactBytes: 100,
			artefactSha256: 'e'.repeat(64),
			documentCount: 1,
			budgetCredits: 1000,
			estimate: { documentCount: 1, estimatedMinutes: 1, estimatedCredits: 10 },
			concurrencyLimit: 5
		});
		expect(admission.admitted).toBe(true);

		const sameNameSimilarity: SimilarityFn = (subject, candidate) =>
			subject.name === candidate.name ? 1 : 0;

		const model = scriptedModel([
			toolCallStep([{ id: 'd1', name: 'source_read', input: { path: 'notes/duplicate.md' } }]),
			entityStep('d2', 'e1', 'Aldric Vane', 'doc-1'),
			entityStep('d3', 'e2', 'Aldric Vane', 'doc-1'),
			toolCallStep([
				{
					id: 'd4',
					name: 'relation_propose',
					input: {
						fromLocalId: 'e1',
						toLocalId: 'e2',
						label: 'reports to',
						inverseLabel: 'commands',
						cardinality: 'many_to_one',
						sourceRef: { documentId: 'doc-1' },
						evidenceSpan: { start: 0, end: 20 }
					}
				}
			]),
			finishStep('d5')
		]);
		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});

		const runner = new ImportJobRunner();
		const result = await runner.run({
			db,
			driver,
			dbJobId: admission.jobId,
			universeId,
			sourceSystem: 'obsidian',
			userId,
			playbook,
			documents: [{ id: 'doc-1', sourcePath: 'notes/duplicate.md' }],
			sources,
			images: new InMemoryImageStore(),
			budget: { maxCredits: 1000 },
			similarity: sameNameSimilarity,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 },
			embedRelationLabel: stubEmbedRelationLabel,
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('finished');

		const rows = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		// Both mentions resolve, via similarity, to the pre-existing entity, so this
		// document proposes two `update` candidates and, without the fix, one `relation`
		// candidate whose from and to are the same entity id - a self-loop that
		// `relation_from_ne_to` refuses at accept time. The fix drops it before it is ever
		// proposed.
		expect(rows.some((r) => r.kind === 'relation')).toBe(false);
		expect(rows.filter((r) => r.kind === 'update')).toHaveLength(2);
		expect(rows.every((r) => r.targetEntityId === existingEntity.id)).toBe(true);
	});

	describe('missing_in_source bookkeeping (issue #163, SPEC.md §6.4)', () => {
		async function admitJob(
			universeId: string,
			userId: string,
			playbook: LoadedPlaybook,
			documentCount: number,
			seed: string
		) {
			return admitAndCreateImportJob(db, {
				universeId,
				createdBy: userId,
				sourceType: 'obsidian',
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: `s3://fixtures/${seed}.zip`,
				artefactBytes: 100,
				artefactSha256: seed.repeat(64).slice(0, 64),
				documentCount,
				budgetCredits: 1000,
				estimate: { documentCount, estimatedMinutes: 1, estimatedCredits: documentCount * 10 },
				concurrencyLimit: 5
			});
		}

		/** Accepting every pending proposal is what actually writes `entity_source_ref`
		 * (SPEC.md §6.4 step 1 only ever matches against entities that exist) - this
		 * mirrors the review UI's own accept action, resolving each proposal's source path
		 * from its patch name via the map the test built its fixture from. */
		async function acceptAllPending(
			universeId: string,
			jobId: string,
			pathByName: Record<string, string>,
			contentByPath: Record<string, string>
		) {
			const rows = await db
				.select()
				.from(proposalTable)
				.where(eq(proposalTable.universeId, universeId));
			for (const row of rows) {
				const name = patchName(row.patch);
				const path = name ? pathByName[name] : undefined;
				if (!path) throw new Error(`no fixture path for proposal patch name "${String(name)}"`);
				await acceptImportProposal(db, {
					proposalId: row.id,
					sourceSystem: 'obsidian',
					externalId: path,
					sourceUrl: null,
					contentHash: createHashOf(contentByPath[path]!),
					importJobId: jobId
				});
			}
		}

		async function sourceRefFor(externalId: string) {
			const [row] = await db
				.select()
				.from(entitySourceRef)
				.where(eq(entitySourceRef.externalId, externalId));
			return row;
		}

		it('marks the ref behind a document a shorter re-import no longer carries, leaves the one still present alone, and stamps the marking job', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const docAContent = 'Entity A lives on in the vault.';
			const docBContent = 'Entity B is an old session log.';
			const pathByName = { 'Entity A': 'notes/a.md', 'Entity B': 'notes/b.md' };
			const contentByPath = { 'notes/a.md': docAContent, 'notes/b.md': docBContent };
			const sourcesV1 = new InMemorySourceReader({ files: contentByPath });
			const bothDocuments = [
				{ id: 'doc-a', sourcePath: 'notes/a.md' },
				{ id: 'doc-b', sourcePath: 'notes/b.md' }
			];

			const admission1 = await admitJob(universeId, userId, playbook, 2, '1');
			const runner = new ImportJobRunner();
			const model1 = scriptedModel([
				toolCallStep([{ id: 'm1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('m2', 'ea', 'Entity A', 'doc-a'),
				finishStep('m3'),
				toolCallStep([{ id: 'm4', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('m5', 'eb', 'Entity B', 'doc-b'),
				finishStep('m6')
			]);
			const driver1 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model1)
			});
			const run1 = await runner.run({
				db,
				dbJobId: admission1.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: bothDocuments,
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver1
			});
			expect(run1.finalStatus).toBe('finished');
			await acceptAllPending(universeId, admission1.jobId, pathByName, contentByPath);

			// v2 export: document B is quietly gone, document A's content is unchanged -
			// the whole run is the "skip everything, nothing to reprocess" early exit.
			const admission2 = await admitJob(universeId, userId, playbook, 1, '2');
			const model2 = scriptedModel([finishStep('never')]);
			const driver2 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model2)
			});
			const run2 = await runner.run({
				db,
				dbJobId: admission2.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [{ id: 'doc-a', sourcePath: 'notes/a.md' }],
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver2
			});
			expect(run2.finalStatus).toBe('finished');
			expect(model2.doGenerateCalls).toHaveLength(0);

			const aRow = await sourceRefFor('notes/a.md');
			expect(aRow?.missingInSource).toBe(false);

			const bRow = await sourceRefFor('notes/b.md');
			expect(bRow?.missingInSource).toBe(true);
			expect(bRow?.lastImportJobId).toBe(admission2.jobId);

			const missing = await missingEntitySourceRefsForJob(db, admission2.jobId);
			expect(missing).toEqual([expect.objectContaining({ name: 'Entity B' })]);
		});

		it('unmarks a previously missing ref once its document reappears with unchanged content', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const docAContent = 'Entity A lives on in the vault.';
			const docBContent = 'Session 1: the party makes landfall.';
			const pathByName = { 'Entity A': 'notes/a.md', 'Session 1': 'notes/b.md' };
			const contentByPath = { 'notes/a.md': docAContent, 'notes/b.md': docBContent };
			const sourcesV1 = new InMemorySourceReader({ files: contentByPath });
			const bothDocuments = [
				{ id: 'doc-a', sourcePath: 'notes/a.md' },
				{ id: 'doc-b', sourcePath: 'notes/b.md' }
			];
			const runner = new ImportJobRunner();

			const admission1 = await admitJob(universeId, userId, playbook, 2, '3');
			const model1 = scriptedModel([
				toolCallStep([{ id: 'r1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('r2', 'ea', 'Entity A', 'doc-a'),
				finishStep('r3'),
				toolCallStep([{ id: 'r4', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('r5', 'eb', 'Session 1', 'doc-b'),
				finishStep('r6')
			]);
			const driver1 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model1)
			});
			const run1 = await runner.run({
				db,
				dbJobId: admission1.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: bothDocuments,
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver1
			});
			expect(run1.finalStatus).toBe('finished');
			await acceptAllPending(universeId, admission1.jobId, pathByName, contentByPath);

			// v2: session-1 is tidied out of the vault.
			const admission2 = await admitJob(universeId, userId, playbook, 1, '4');
			const model2 = scriptedModel([finishStep('never')]);
			const driver2 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model2)
			});
			await runner.run({
				db,
				dbJobId: admission2.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [{ id: 'doc-a', sourcePath: 'notes/a.md' }],
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver2
			});
			expect((await sourceRefFor('notes/b.md'))?.missingInSource).toBe(true);

			// v3: the GM restores it, unchanged.
			const admission3 = await admitJob(universeId, userId, playbook, 2, '5');
			const model3 = scriptedModel([finishStep('never')]);
			const driver3 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model3)
			});
			const run3 = await runner.run({
				db,
				dbJobId: admission3.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: bothDocuments,
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver3
			});
			expect(run3.finalStatus).toBe('finished');
			expect(model3.doGenerateCalls).toHaveLength(0);
			expect((await sourceRefFor('notes/b.md'))?.missingInSource).toBe(false);
		});

		it('a job that stops at its credit ceiling marks nothing missing, even though a document is absent from its list', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const docAContent = 'Entity A lives on in the vault.';
			const docBContent = 'Entity B is an old session log.';
			const pathByName = { 'Entity A': 'notes/a.md', 'Entity B': 'notes/b.md' };
			const contentByPath = { 'notes/a.md': docAContent, 'notes/b.md': docBContent };
			const sourcesV1 = new InMemorySourceReader({ files: contentByPath });
			const bothDocuments = [
				{ id: 'doc-a', sourcePath: 'notes/a.md' },
				{ id: 'doc-b', sourcePath: 'notes/b.md' }
			];
			const runner = new ImportJobRunner();

			const admission1 = await admitJob(universeId, userId, playbook, 2, '6');
			const model1 = scriptedModel([
				toolCallStep([{ id: 'c1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('c2', 'ea', 'Entity A', 'doc-a'),
				finishStep('c3'),
				toolCallStep([{ id: 'c4', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('c5', 'eb', 'Entity B', 'doc-b'),
				finishStep('c6')
			]);
			const driver1 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model1)
			});
			const run1 = await runner.run({
				db,
				dbJobId: admission1.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: bothDocuments,
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver1
			});
			expect(run1.finalStatus).toBe('finished');
			await acceptAllPending(universeId, admission1.jobId, pathByName, contentByPath);

			// v2: document A changed (forces reprocessing), document B is genuinely dropped
			// from the export - but this run's own credit ceiling trips right after
			// document A's first step, before it (or B) ever reaches a clean finish.
			const changedDocAContent = 'Entity A, revised for v2.';
			const sourcesV2 = new InMemorySourceReader({ files: { 'notes/a.md': changedDocAContent } });
			const admission2 = await admitJob(universeId, userId, playbook, 1, '7');
			const model2 = scriptedModel([
				toolCallStep([{ id: 'c7', name: 'source_read', input: { path: 'notes/a.md' } }]),
				finishStep('never')
			]);
			const driver2 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model2)
			});
			const run2 = await runner.run({
				db,
				dbJobId: admission2.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [{ id: 'doc-a', sourcePath: 'notes/a.md' }],
				sources: sourcesV2,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 0.001 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver2
			});

			expect(run2.finalStatus).toBe('stopped_at_ceiling');
			expect(model2.doGenerateCalls).toHaveLength(1);
			expect((await sourceRefFor('notes/b.md'))?.missingInSource).toBe(false);
			expect(await missingEntitySourceRefsForJob(db, admission2.jobId)).toEqual([]);
		});

		it('a cancelled job marks nothing missing, even though a document is absent from its list', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const docAContent = 'Entity A lives on in the vault.';
			const docBContent = 'Entity B is an old session log.';
			const pathByName = { 'Entity A': 'notes/a.md', 'Entity B': 'notes/b.md' };
			const contentByPath = { 'notes/a.md': docAContent, 'notes/b.md': docBContent };
			const sourcesV1 = new InMemorySourceReader({ files: contentByPath });
			const bothDocuments = [
				{ id: 'doc-a', sourcePath: 'notes/a.md' },
				{ id: 'doc-b', sourcePath: 'notes/b.md' }
			];
			const runner = new ImportJobRunner();

			const admission1 = await admitJob(universeId, userId, playbook, 2, '8');
			const model1 = scriptedModel([
				toolCallStep([{ id: 'k1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('k2', 'ea', 'Entity A', 'doc-a'),
				finishStep('k3'),
				toolCallStep([{ id: 'k4', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('k5', 'eb', 'Entity B', 'doc-b'),
				finishStep('k6')
			]);
			const driver1 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model1)
			});
			const run1 = await runner.run({
				db,
				dbJobId: admission1.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: bothDocuments,
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver1
			});
			expect(run1.finalStatus).toBe('finished');
			await acceptAllPending(universeId, admission1.jobId, pathByName, contentByPath);

			// v2: document A changed, document B is genuinely dropped from the export - but
			// the GM cancels mid-document before this run ever settles as finished.
			const changedDocAContent = 'Entity A, revised for v2.';
			const sourcesV2 = new InMemorySourceReader({ files: { 'notes/a.md': changedDocAContent } });
			const admission2 = await admitJob(universeId, userId, playbook, 1, '9');
			const model2 = scriptedModel([
				toolCallStep([{ id: 'k7', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('k8', 'ea', 'Entity A', 'doc-a'),
				finishStep('never')
			]);
			let resolvedSteps = 0;
			let cancellingDriver: GatewayDriver;
			const cancellingSelector: ModelSelector = {
				resolve: async (purpose) => {
					resolvedSteps += 1;
					if (resolvedSteps === 2) cancellingDriver.cancel(admission2.jobId);
					return fixedModelSelector(model2).resolve(purpose);
				}
			};
			cancellingDriver = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: cancellingSelector
			});

			const run2 = await runner.run({
				db,
				dbJobId: admission2.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [{ id: 'doc-a', sourcePath: 'notes/a.md' }],
				sources: sourcesV2,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: cancellingDriver
			});

			expect(run2.finalStatus).toBe('cancelled');
			expect((await sourceRefFor('notes/b.md'))?.missingInSource).toBe(false);
			expect(await missingEntitySourceRefsForJob(db, admission2.jobId)).toEqual([]);
		});

		it('a failed job marks nothing missing, even though a document is absent from its list', async () => {
			await priceFixture();
			const { userId, universeId } = await userAndUniverse();
			const playbook = await loadBuiltinPlaybook('generic');
			const docAContent = 'Entity A lives on in the vault.';
			const docBContent = 'Entity B is an old session log.';
			const pathByName = { 'Entity A': 'notes/a.md', 'Entity B': 'notes/b.md' };
			const contentByPath = { 'notes/a.md': docAContent, 'notes/b.md': docBContent };
			const sourcesV1 = new InMemorySourceReader({ files: contentByPath });
			const bothDocuments = [
				{ id: 'doc-a', sourcePath: 'notes/a.md' },
				{ id: 'doc-b', sourcePath: 'notes/b.md' }
			];
			const runner = new ImportJobRunner();

			const admission1 = await admitJob(universeId, userId, playbook, 2, 'a');
			const model1 = scriptedModel([
				toolCallStep([{ id: 'f1', name: 'source_read', input: { path: 'notes/a.md' } }]),
				entityStep('f2', 'ea', 'Entity A', 'doc-a'),
				finishStep('f3'),
				toolCallStep([{ id: 'f4', name: 'source_read', input: { path: 'notes/b.md' } }]),
				entityStep('f5', 'eb', 'Entity B', 'doc-b'),
				finishStep('f6')
			]);
			const driver1 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(model1)
			});
			const run1 = await runner.run({
				db,
				dbJobId: admission1.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: bothDocuments,
				sources: sourcesV1,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver1
			});
			expect(run1.finalStatus).toBe('finished');
			await acceptAllPending(universeId, admission1.jobId, pathByName, contentByPath);

			// v2: document A changed, document B genuinely dropped - but the model call for
			// A's first step throws, so this run settles as failed rather than finished.
			const changedDocAContent = 'Entity A, revised for v2.';
			const sourcesV2 = new InMemorySourceReader({ files: { 'notes/a.md': changedDocAContent } });
			const admission2 = await admitJob(universeId, userId, playbook, 1, 'b');
			const throwingModel = new MockLanguageModelV4({
				provider: 'test',
				modelId: 'test-cheap',
				doGenerate: async () => {
					throw new Error('synthetic model failure');
				}
			});
			const driver2 = new GatewayDriver({
				gateway: IDENTITY_GATEWAY,
				models: fixedModelSelector(throwingModel)
			});

			const run2 = await runner.run({
				db,
				dbJobId: admission2.jobId,
				universeId,
				sourceSystem: 'obsidian',
				userId,
				playbook,
				documents: [{ id: 'doc-a', sourcePath: 'notes/a.md' }],
				sources: sourcesV2,
				images: new InMemoryImageStore(),
				budget: { maxCredits: 1000 },
				similarity: () => 0,
				thresholds: { matchAbove: 0.85, newBelow: 0.5 },
				embedRelationLabel: stubEmbedRelationLabel,
				timeoutMs: 30_000,
				driver: driver2
			});

			expect(run2.finalStatus).toBe('failed');
			expect((await sourceRefFor('notes/b.md'))?.missingInSource).toBe(false);
			expect(await missingEntitySourceRefsForJob(db, admission2.jobId)).toEqual([]);
		});
	});
});
