import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { closeDb, createDb, eq, getImportJob, runMigrations, type Db } from '@canonry/db';
import { operationPrice, proposal as proposalTable, universe, user } from '@canonry/db/schema';
import postgres from 'postgres';
import {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector
} from './gateway-driver.js';
import { loadBuiltinPlaybook } from './playbook.js';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import {
	acceptImportProposal,
	admitAndCreateImportJob,
	ImportJobRunner,
	type RunImportJobParams
} from './job-runner.js';

function createHashOf(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

const suffix = process.env.TEST_DB_SUFFIX ?? 'jobrunner-local';
const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_jr_${suffix}`;

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

const TEST_PARAMS = { eurPerInputMTok: 1, eurPerOutputMTok: 2, creditsPerEur: 100 };
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

function entityStep(
	id: string,
	localId: string,
	name: string,
	documentId: string,
	sourcePath: string
) {
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
				sourceRef: { documentId, path: sourcePath },
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

function finishStep(id: string, documentId: string) {
	return toolCallStep([{ id, name: 'job_finish', input: { documentId, outcome: 'completed' } }]);
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
			timeoutMs: 30_000
		};

		const model1 = scriptedModel([
			toolCallStep([{ id: 'r1', name: 'source_read', input: { path: 'notes/aldric.md' } }]),
			entityStep('r2', 'e1', 'Aldric Voss', 'doc-1', 'notes/aldric.md'),
			finishStep('r3', 'doc-1')
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

		const model2 = scriptedModel([finishStep('never', 'doc-1')]);
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
				status: 'skipped_unchanged',
				entityCount: 0,
				relationCount: 0,
				proposalsCreated: 0
			}
		]);
		// The model was never even called for the second job.
		expect(model2.doGenerateCalls).toHaveLength(0);
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

		// A tiny job-wide credit budget: document A's steps alone exceed it, so document B
		// never starts this run.
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
			timeoutMs: 30_000
		};

		const modelA = scriptedModel([
			toolCallStep([{ id: 'a1', name: 'source_read', input: { path: 'notes/a.md' } }]),
			entityStep('a2', 'ea', 'Entity A', 'doc-a', 'notes/a.md'),
			finishStep('a3', 'doc-a')
		]);
		const driverA = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(modelA)
		});
		// TEST_PARAMS costs ~0.002 credits/step (usage(10,5) against eurPerInputMTok 1,
		// eurPerOutputMTok 2, creditsPerEur 100), so document A's 3 steps spend ~0.006 -
		// a ceiling of 0.005 trips right after document A finishes, before document B
		// ever starts.
		const firstRun = await runner.run({
			...paramsBase,
			driver: driverA,
			budget: { maxCredits: 0.005 }
		});

		expect(firstRun.finalStatus).toBe('stopped_at_ceiling');
		const proposalsAfterCeiling = await db
			.select()
			.from(proposalTable)
			.where(eq(proposalTable.universeId, universeId));
		expect(proposalsAfterCeiling.length).toBeGreaterThanOrEqual(1);
		expect(proposalsAfterCeiling.some((p) => patchName(p.patch) === 'Entity A')).toBe(true);

		const jobAfterCeiling = await getImportJob(db, admission.jobId);
		expect(jobAfterCeiling.status).toBe('stopped_at_ceiling');

		// Resume: same job id, a real budget this time. Document A is already checkpointed
		// finished and must not run again; only document B should call the model.
		const modelB = scriptedModel([
			toolCallStep([{ id: 'b1', name: 'source_read', input: { path: 'notes/b.md' } }]),
			entityStep('b2', 'eb', 'Entity B', 'doc-b', 'notes/b.md'),
			finishStep('b3', 'doc-b')
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
		expect(resumed.documents.map((d) => d.documentId)).toEqual(['doc-b']);
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
			entityStep('c2', 'ec', 'Entity C', 'doc-c', 'notes/c.md'),
			// A third step the cancel should prevent from ever running.
			finishStep('c3', 'doc-c')
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
			timeoutMs: 30_000
		});

		expect(result.finalStatus).toBe('cancelled');
		expect(result.documents[0]?.status).toBe('cancelled');
		// The entity proposed in step 2 (before cancellation) is intact; job_finish (step
		// 3) never ran.
		expect(model.doGenerateCalls).toHaveLength(2);

		const jobRow = await getImportJob(db, admission.jobId);
		expect(jobRow.status).toBe('cancelled');
	});
});
