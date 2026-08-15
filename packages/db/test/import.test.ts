import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	acceptImportProposal,
	acceptProposal,
	admitImportJob,
	candidateEntitiesForMatching,
	checkImportQuota,
	closeDb,
	countRunningImportJobs,
	createImportJob,
	createProposalPlan,
	foldEntitySightingIntoPendingProposal,
	getProposal,
	pendingEntityProposalsForJob,
	recordProposalDiff,
	type Db,
	findEntityBySourceRef,
	findOrCreateRelationType,
	getImportJob,
	ImportJobNotFoundError,
	importQuotaForUser,
	importUsageForUser,
	queuePositionFor,
	recordEntitySourceRef,
	settleImportJob,
	updateImportJobCheckpoint
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { entitySourceRef, importJob } from '../src/schema/source.js';
import { userBilling } from '../src/schema/billing.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

describe('import job lifecycle and matching queries (issues #26, #27, #30, #36)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function jobFixture(overrides: Partial<Parameters<typeof createImportJob>[1]> = {}) {
		const owner = await insertUser(db);
		const u = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
		const job = await createImportJob(db, {
			universeId: u.id,
			createdBy: owner.id,
			sourceType: 'generic',
			playbook: 'generic',
			playbookVersion: 1,
			artefactPath: `s3://imports/${unique('artefact')}.zip`,
			artefactBytes: 1024,
			artefactSha256: 'a'.repeat(64),
			documentCount: 3,
			budgetCredits: 100,
			...overrides
		});
		return { universe: u, owner, job };
	}

	describe('createImportJob / getImportJob', () => {
		it('creates a job in the queued status, never running by default', async () => {
			const { job } = await jobFixture();
			expect(job.status).toBe('queued');
			expect(job.startedAt).toBeNull();
			expect(job.finishedAt).toBeNull();
		});

		it('throws ImportJobNotFoundError for an id that does not exist', async () => {
			await expect(getImportJob(db, randomUUID())).rejects.toThrow(ImportJobNotFoundError);
		});
	});

	describe('admitImportJob - the queue and its global concurrency limit (issue #30)', () => {
		it('admits a queued job under the concurrency limit and marks it running', async () => {
			const { job } = await jobFixture();
			const result = await admitImportJob(db, job.id, 5);
			expect(result.admitted).toBe(true);
			expect(result.job.status).toBe('running');
			expect(result.job.startedAt).not.toBeNull();
		});

		it('refuses admission once the concurrency limit is already met, leaving the job queued', async () => {
			const { job: running } = await jobFixture();
			await admitImportJob(db, running.id, 1);
			expect(await countRunningImportJobs(db)).toBeGreaterThanOrEqual(1);

			const before = await countRunningImportJobs(db);
			const { job: waiting } = await jobFixture();
			const result = await admitImportJob(db, waiting.id, before); // limit already met
			expect(result.admitted).toBe(false);
			expect(result.job.status).toBe('queued');
		});

		it('is idempotent - admitting an already-running job again changes nothing and reports it as admitted', async () => {
			const { job } = await jobFixture();
			const first = await admitImportJob(db, job.id, 5);
			const second = await admitImportJob(db, first.job.id, 5);
			expect(second.admitted).toBe(true);
			expect(second.job.status).toBe('running');
			expect(second.job.startedAt?.getTime()).toBe(first.job.startedAt?.getTime());
		});
	});

	describe('queuePositionFor', () => {
		it('reports a 1-based position among still-queued jobs, oldest first, and 0 once running', async () => {
			const { universe: u, owner } = await jobFixture();
			const makeJob = () =>
				createImportJob(db, {
					universeId: u.id,
					createdBy: owner.id,
					sourceType: 'generic',
					playbook: 'generic',
					playbookVersion: 1,
					artefactPath: `s3://imports/${unique('artefact')}.zip`,
					artefactBytes: 10,
					artefactSha256: unique('hash').padEnd(64, '0'),
					documentCount: 1,
					budgetCredits: 10
				});
			const first = await makeJob();
			const second = await makeJob();

			expect(await queuePositionFor(db, first.id)).toBeGreaterThanOrEqual(1);
			const secondPosition = await queuePositionFor(db, second.id);
			const firstPosition = await queuePositionFor(db, first.id);
			expect(secondPosition).toBeGreaterThan(firstPosition);

			await admitImportJob(db, first.id, 999);
			expect(await queuePositionFor(db, first.id)).toBe(0);
		});
	});

	describe('updateImportJobCheckpoint (issue #27)', () => {
		it('replaces the checkpoint and accumulates spent credits and tokens across calls', async () => {
			const { job } = await jobFixture();
			const first = await updateImportJobCheckpoint(db, job.id, {
				checkpoint: { documentId: 'doc-1', step: 3 },
				spentCreditsDelta: 5,
				inputTokensDelta: 100,
				outputTokensDelta: 40
			});
			expect(first.checkpoint).toEqual({ documentId: 'doc-1', step: 3 });
			expect(first.spentCredits).toBe(5);
			expect(first.inputTokens).toBe(100);
			expect(first.outputTokens).toBe(40);

			const second = await updateImportJobCheckpoint(db, job.id, {
				checkpoint: { documentId: 'doc-1', step: 7 },
				spentCreditsDelta: 3,
				inputTokensDelta: 50,
				outputTokensDelta: 20
			});
			expect(second.checkpoint).toEqual({ documentId: 'doc-1', step: 7 });
			expect(second.spentCredits).toBe(8);
			expect(second.inputTokens).toBe(150);
			expect(second.outputTokens).toBe(60);
		});
	});

	describe('settleImportJob - settles exactly once (issue #26)', () => {
		it('moves a running job to a terminal status and stamps finishedAt', async () => {
			const { job } = await jobFixture();
			await admitImportJob(db, job.id, 5);
			const result = await settleImportJob(db, job.id, {
				status: 'finished',
				outcomeNote: 'all documents completed',
				proposalsEmitted: 4
			});
			expect(result.settled).toBe(true);
			expect(result.job.status).toBe('finished');
			expect(result.job.finishedAt).not.toBeNull();
		});

		it('refuses to settle a job twice once truly final - a second attempt reports settled: false and leaves the first outcome intact', async () => {
			const { job } = await jobFixture();
			await admitImportJob(db, job.id, 5);
			const first = await settleImportJob(db, job.id, {
				status: 'finished',
				outcomeNote: 'all documents completed',
				proposalsEmitted: 2
			});
			expect(first.settled).toBe(true);

			// A cancel racing the natural finish, or a retry - either way the second call
			// must not overwrite the first, real outcome.
			const second = await settleImportJob(db, job.id, {
				status: 'cancelled',
				outcomeNote: 'cancel requested',
				proposalsEmitted: 999
			});
			expect(second.settled).toBe(false);
			expect(second.job.status).toBe('finished');
			expect(second.job.proposalsEmitted).toBe(2);
		});

		it('allows a resumed run to settle a stopped_at_ceiling job again - SPEC.md §6.7 makes that status resumable, not final', async () => {
			const { job } = await jobFixture();
			await admitImportJob(db, job.id, 5);
			const first = await settleImportJob(db, job.id, {
				status: 'stopped_at_ceiling',
				outcomeNote: "this job's credit budget is exhausted",
				proposalsEmitted: 2
			});
			expect(first.settled).toBe(true);

			const resumed = await settleImportJob(db, job.id, {
				status: 'finished',
				outcomeNote: 'resumed and completed the remaining documents',
				proposalsEmitted: 3
			});
			expect(resumed.settled).toBe(true);
			expect(resumed.job.status).toBe('finished');
			expect(resumed.job.proposalsEmitted).toBe(3);
		});
	});

	describe('quota (issue #30)', () => {
		it('counts usage from import_job rows rather than a running total, so a cancelled job still counts', async () => {
			const { universe: u, owner, job } = await jobFixture({ documentCount: 5 });
			await settleImportJob(db, job.id, {
				status: 'cancelled',
				outcomeNote: 'user cancelled',
				proposalsEmitted: 0
			});

			const usage = await importUsageForUser(db, owner.id, new Date(Date.now() - 60_000));
			expect(usage.jobCount).toBeGreaterThanOrEqual(1);
			expect(usage.documentCount).toBeGreaterThanOrEqual(5);
			void u;
		});

		it('gives a brand new user a real, finite (possibly null) quota row rather than erroring', async () => {
			const owner = await insertUser(db);
			const quota = await importQuotaForUser(db, owner.id);
			expect(quota.jobsQuota === null || typeof quota.jobsQuota === 'number').toBe(true);
			expect(quota.documentsQuota === null || typeof quota.documentsQuota === 'number').toBe(true);
		});

		it('refuses admission once the job quota is reached', async () => {
			const owner = await insertUser(db);
			await db
				.update(userBilling)
				.set({ importJobsQuota: 1 })
				.where(eq(userBilling.userId, owner.id));
			// ensureBilling inside importQuotaForUser only inserts if missing, so seed the row first.
			await importQuotaForUser(db, owner.id);
			await db
				.update(userBilling)
				.set({ importJobsQuota: 1 })
				.where(eq(userBilling.userId, owner.id));

			const quota = await importQuotaForUser(db, owner.id);
			const usage = { jobCount: 1, documentCount: 0 };
			const result = checkImportQuota({
				quota,
				usage,
				availableCredits: 1000,
				estimate: { documentCount: 1, estimatedCredits: 1 }
			});
			expect(result).toEqual({ allowed: false, reason: 'jobs_quota' });
		});

		it('refuses admission once the estimated cost exceeds the available balance', () => {
			const result = checkImportQuota({
				quota: { jobsQuota: null, documentsQuota: null, periodStart: new Date() },
				usage: { jobCount: 0, documentCount: 0 },
				availableCredits: 5,
				estimate: { documentCount: 1, estimatedCredits: 50 }
			});
			expect(result).toEqual({ allowed: false, reason: 'insufficient_credits' });
		});

		it('allows admission when every check passes', () => {
			const result = checkImportQuota({
				quota: { jobsQuota: 10, documentsQuota: 100, periodStart: new Date() },
				usage: { jobCount: 1, documentCount: 5 },
				availableCredits: 1000,
				estimate: { documentCount: 3, estimatedCredits: 20 }
			});
			expect(result).toEqual({ allowed: true });
		});
	});

	describe('findEntityBySourceRef / recordEntitySourceRef (issue #36)', () => {
		it('finds nothing for a source ref that was never recorded', async () => {
			const { universe: u } = await jobFixture();
			const found = await findEntityBySourceRef(db, u.id, 'obsidian', 'never-seen.md');
			expect(found).toBeNull();
		});

		it('records a source ref and then finds it by exact external id, scoped to the universe', async () => {
			const { universe: u, job } = await jobFixture();
			const [target] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'place',
					name: 'Brackwater Mire',
					slug: unique('brackwater'),
					body: 'A swamp.'
				})
				.returning();
			if (!target) throw new Error('fixture setup failed');

			const externalId = unique('notes/brackwater.md');
			await recordEntitySourceRef(db, {
				entityId: target.id,
				sourceSystem: 'obsidian',
				externalId,
				sourceUrl: null,
				contentHash: 'hash-v1',
				lastImportJobId: job.id
			});

			const found = await findEntityBySourceRef(db, u.id, 'obsidian', externalId);
			expect(found).toMatchObject({
				entityId: target.id,
				name: 'Brackwater Mire',
				contentHash: 'hash-v1'
			});

			// A second run's re-import - same document, same content - updates in place
			// (upsert), not a duplicate row.
			await recordEntitySourceRef(db, {
				entityId: target.id,
				sourceSystem: 'obsidian',
				externalId,
				sourceUrl: null,
				contentHash: 'hash-v1',
				lastImportJobId: job.id
			});
			const rows = await db
				.select()
				.from(entitySourceRef)
				.where(eq(entitySourceRef.externalId, externalId));
			expect(rows).toHaveLength(1);
		});
	});

	describe('candidateEntitiesForMatching', () => {
		it('returns only entities of the requested type in the requested universe', async () => {
			const { universe: u } = await jobFixture();
			await db.insert(entity).values([
				{
					universeId: u.id,
					type: 'character',
					name: 'Aldric Voss',
					slug: unique('aldric'),
					body: ''
				},
				{
					universeId: u.id,
					type: 'place',
					name: 'Thornwick College',
					slug: unique('thornwick'),
					body: ''
				}
			]);
			const candidates = await candidateEntitiesForMatching(db, u.id, 'character');
			expect(candidates.some((c) => c.name === 'Aldric Voss')).toBe(true);
			expect(candidates.some((c) => c.name === 'Thornwick College')).toBe(false);
		});
	});

	describe('pendingEntityProposalsForJob / foldEntitySightingIntoPendingProposal (issue #160)', () => {
		async function pendingCreateCandidate(
			jobId: string,
			universeId: string,
			type: 'character' | 'place',
			name: string,
			aliases: string[] = []
		) {
			const { proposals } = await createProposalPlan(db, {
				universeId,
				trigger: 'import',
				importJobId: jobId,
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 0,
				candidates: [
					{ kind: 'create', targetEntityId: null, rationale: 'r', evidence: [], rank: 0 }
				]
			});
			const created = proposals[0]!;
			await recordProposalDiff(db, {
				proposalId: created.id,
				patch: { type, name, slug: unique(name.toLowerCase()), aliases, body: 'x' },
				provider: 'test',
				modelId: 'test',
				credits: 0
			});
			return created;
		}

		it("only returns this job's own pending create proposals of the requested type", async () => {
			const { universe: u, job } = await jobFixture();
			const { job: otherJob } = await jobFixture();

			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane');
			await pendingCreateCandidate(job.id, u.id, 'place', 'Port Verity');
			await pendingCreateCandidate(otherJob.id, u.id, 'character', 'Mira Sable');

			const candidates = await pendingEntityProposalsForJob(db, job.id, 'character');
			expect(candidates).toEqual([{ id: character.id, name: 'Aldric Vane', aliases: [] }]);
		});

		it('stops returning a proposal once it is no longer pending', async () => {
			const { universe: u, job } = await jobFixture();
			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane');

			await acceptProposal(db, { proposalId: character.id });

			const candidates = await pendingEntityProposalsForJob(db, job.id, 'character');
			expect(candidates).toEqual([]);
		});

		it("folds a repeat sighting's new names into the pending proposal's alias list", async () => {
			const { universe: u, job } = await jobFixture();
			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane', [
				'Al'
			]);

			await foldEntitySightingIntoPendingProposal(db, {
				proposalId: character.id,
				// "Aldric Vane" repeats the patch's own name (dropped) and "Al" repeats an
				// alias already there (dropped); "Captain Vane" is genuinely new.
				names: ['Aldric Vane', 'Al', 'Captain Vane']
			});

			const row = await getProposal(db, character.id);
			expect(row?.patch).toMatchObject({ aliases: ['Al', 'Captain Vane'] });
		});

		it('is a no-op once the proposal is no longer pending, rather than reviving it', async () => {
			const { universe: u, job } = await jobFixture();
			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane');
			await acceptProposal(db, { proposalId: character.id });

			await foldEntitySightingIntoPendingProposal(db, {
				proposalId: character.id,
				names: ['A Name That Should Never Land']
			});

			const row = await getProposal(db, character.id);
			expect(row?.outcome).toBe('accepted');
			expect(row?.patch).toMatchObject({ aliases: [] });
		});
	});

	describe('findOrCreateRelationType', () => {
		it('creates a relation type once and reuses it on a second call with the same label', async () => {
			const { universe: u } = await jobFixture();
			const first = await findOrCreateRelationType(db, {
				universeId: u.id,
				label: 'commands',
				inverseLabel: 'commanded by',
				cardinality: 'one_to_many',
				allowedFrom: 'character',
				allowedTo: 'faction'
			});
			const second = await findOrCreateRelationType(db, {
				universeId: u.id,
				label: 'commands',
				inverseLabel: 'commanded by',
				cardinality: 'one_to_many',
				allowedFrom: 'character',
				allowedTo: 'faction'
			});
			expect(second.id).toBe(first.id);
		});
	});

	describe('acceptImportProposal (issue #36)', () => {
		it('accepts a create proposal and records the entity_source_ref against the newly created entity', async () => {
			const { universe: u, job } = await jobFixture();
			const slug = unique('mira-sable');
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'import',
				summary: 'Import: 1 new entity',
				candidateCap: 10,
				estimatedCredits: 0,
				candidates: [
					{
						kind: 'create',
						targetEntityId: null,
						rationale: 'Extracted from notes/mira.md',
						evidence: { documentId: 'doc-1', span: { start: 0, end: 20 } },
						rank: 0
					}
				]
			});
			const created = proposals[0];
			if (!created) throw new Error('fixture setup failed');
			await recordProposalDiff(db, {
				proposalId: created.id,
				patch: {
					type: 'character',
					name: 'Mira Sable',
					slug,
					aliases: [],
					body: 'Commands the watch.'
				},
				provider: 'test',
				modelId: 'test-cheap',
				credits: 0
			});

			const externalId = unique('notes/mira.md');
			const accepted = await acceptImportProposal(db, {
				proposalId: created.id,
				sourceSystem: 'obsidian',
				externalId,
				sourceUrl: null,
				contentHash: 'hash-mira-v1',
				importJobId: job.id
			});
			expect(accepted.outcome).toBe('accepted');

			const found = await findEntityBySourceRef(db, u.id, 'obsidian', externalId);
			expect(found).not.toBeNull();
			expect(found?.name).toBe('Mira Sable');

			const entityRow = await db.select().from(entity).where(eq(entity.slug, slug)).limit(1);
			expect(entityRow[0]?.name).toBe('Mira Sable');
		});
	});

	// Sanity: import_job rows created above are visible through a plain select too, in
	// case a future refactor of createImportJob silently drops a column.
	it('createImportJob persists every field it was given', async () => {
		const {
			job,
			universe: u,
			owner
		} = await jobFixture({ sourceType: 'kanka', playbookVersion: 3 });
		const [row] = await db.select().from(importJob).where(eq(importJob.id, job.id)).limit(1);
		expect(row).toMatchObject({
			universeId: u.id,
			createdBy: owner.id,
			sourceType: 'kanka',
			playbook: 'generic',
			playbookVersion: 3
		});
	});
});
