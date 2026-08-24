import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
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
	entitiesByIdentity,
	entityUpdateTargetsByIds,
	foldEntitySightingIntoPendingProposal,
	getProposal,
	missingEntitySourceRefsForJob,
	pendingEntityProposalsByIdentity,
	pendingEntityProposalsForJob,
	recordProposalDiff,
	type Db,
	findEntityBySourceRef,
	getImportJob,
	ImportJobNotFoundError,
	importQuotaForUser,
	importUsageForUser,
	queuePositionFor,
	recordEntitySourceRef,
	settleImportJob,
	syncMissingEntitySourceRefs,
	updateImportJobCheckpoint
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { entitySourceRef, importJob } from '../src/schema/source.js';
import { userBilling } from '../src/schema/billing.js';
import {
	insertHomebrewUniverse,
	insertUser,
	TEST_CONCURRENCY_LIMIT,
	testDb,
	unique
} from './helpers.js';

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
			// issue #682: a budget no sibling file can spend. `TEST_CONCURRENCY_LIMIT` has why.
			const result = await admitImportJob(db, job.id, TEST_CONCURRENCY_LIMIT);
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
			// issue #682: a budget no sibling file can spend. `TEST_CONCURRENCY_LIMIT` has why.
			const first = await admitImportJob(db, job.id, TEST_CONCURRENCY_LIMIT);
			const second = await admitImportJob(db, first.job.id, TEST_CONCURRENCY_LIMIT);
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

			// issue #682: read `first` before `second`, not after. Both counts include every
			// queued row in the database, and `metrics.test.ts` inserts import jobs backdated to
			// 2026-01-01, so a sibling insert between the two reads only ever raises the position
			// read second. Reading the older job first therefore keeps the comparison true, and
			// reading it last was one interleaving away from inverting it.
			const firstPosition = await queuePositionFor(db, first.id);
			expect(firstPosition).toBeGreaterThanOrEqual(1);
			const secondPosition = await queuePositionFor(db, second.id);
			expect(secondPosition).toBeGreaterThan(firstPosition);

			await admitImportJob(db, first.id, TEST_CONCURRENCY_LIMIT);
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
			await admitImportJob(db, job.id, TEST_CONCURRENCY_LIMIT);
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
			await admitImportJob(db, job.id, TEST_CONCURRENCY_LIMIT);
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
			await admitImportJob(db, job.id, TEST_CONCURRENCY_LIMIT);
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

	describe('syncMissingEntitySourceRefs / missingEntitySourceRefsForJob (issue #163, SPEC.md §6.4)', () => {
		async function entityWithSourceRef(
			universeId: string,
			name: string,
			externalId: string,
			importJobId: string
		) {
			const [row] = await db
				.insert(entity)
				.values({
					universeId,
					type: 'character',
					name,
					slug: unique(name.toLowerCase().replace(/\s+/g, '-')),
					body: ''
				})
				.returning();
			if (!row) throw new Error('fixture setup failed');
			await recordEntitySourceRef(db, {
				entityId: row.id,
				sourceSystem: 'obsidian',
				externalId,
				sourceUrl: null,
				contentHash: 'hash-v1',
				lastImportJobId: importJobId
			});
			return row;
		}

		async function jobInSameUniverse(universeId: string, ownerId: string) {
			return createImportJob(db, {
				universeId,
				createdBy: ownerId,
				sourceType: 'obsidian',
				playbook: 'obsidian',
				playbookVersion: 1,
				artefactPath: `s3://imports/${unique('artefact')}.zip`,
				artefactBytes: 100,
				artefactSha256: unique('hash').padEnd(64, '0'),
				documentCount: 1,
				budgetCredits: 100
			});
		}

		it("marks the ref this run's document list did not touch, leaves the touched one alone, and stamps the marking job's id", async () => {
			const { universe: u, owner, job: firstJob } = await jobFixture();
			const stayingPath = unique('notes/aldric.md');
			const vanishingPath = unique('notes/drowned-concord.md');
			await entityWithSourceRef(u.id, 'Aldric Voss', stayingPath, firstJob.id);
			const vanishing = await entityWithSourceRef(
				u.id,
				'The Drowned Concord',
				vanishingPath,
				firstJob.id
			);

			const secondJob = await jobInSameUniverse(u.id, owner.id);
			const result = await syncMissingEntitySourceRefs(db, {
				universeId: u.id,
				sourceSystem: 'obsidian',
				touchedExternalIds: [stayingPath],
				importJobId: secondJob.id
			});

			expect(result.markedMissing).toHaveLength(1);
			expect(result.markedMissing[0]).toMatchObject({
				entityId: vanishing.id,
				missingInSource: true,
				lastImportJobId: secondJob.id
			});
			expect(result.unmarked).toEqual([]);

			const stayingRef = await findEntityBySourceRef(db, u.id, 'obsidian', stayingPath);
			expect(stayingRef).not.toBeNull();
			const stayingRow = await db
				.select()
				.from(entitySourceRef)
				.where(eq(entitySourceRef.externalId, stayingPath));
			expect(stayingRow[0]?.missingInSource).toBe(false);

			const missing = await missingEntitySourceRefsForJob(db, secondJob.id);
			expect(missing).toEqual([
				expect.objectContaining({ entityId: vanishing.id, name: 'The Drowned Concord' })
			]);
		});

		it('unmarks a previously missing ref once its external id reappears in a later run', async () => {
			const { universe: u, owner, job: firstJob } = await jobFixture();
			const returningPath = unique('notes/session-1.md');
			const returning = await entityWithSourceRef(u.id, 'Session 1', returningPath, firstJob.id);

			const secondJob = await jobInSameUniverse(u.id, owner.id);
			await syncMissingEntitySourceRefs(db, {
				universeId: u.id,
				sourceSystem: 'obsidian',
				touchedExternalIds: [],
				importJobId: secondJob.id
			});
			const afterMissing = await db
				.select()
				.from(entitySourceRef)
				.where(eq(entitySourceRef.externalId, returningPath));
			expect(afterMissing[0]?.missingInSource).toBe(true);

			const thirdJob = await jobInSameUniverse(u.id, owner.id);
			const result = await syncMissingEntitySourceRefs(db, {
				universeId: u.id,
				sourceSystem: 'obsidian',
				touchedExternalIds: [returningPath],
				importJobId: thirdJob.id
			});

			expect(result.unmarked).toHaveLength(1);
			expect(result.unmarked[0]).toMatchObject({ entityId: returning.id, missingInSource: false });
			expect(await missingEntitySourceRefsForJob(db, thirdJob.id)).toEqual([]);
		});

		it('never marks a ref with no external id - semantic matching carried it, there is no path to compare', async () => {
			const { universe: u, job } = await jobFixture();
			const [noPathEntity] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'character',
					name: 'Unpathed Wanderer',
					slug: unique('unpathed'),
					body: ''
				})
				.returning();
			if (!noPathEntity) throw new Error('fixture setup failed');
			await recordEntitySourceRef(db, {
				entityId: noPathEntity.id,
				sourceSystem: 'obsidian',
				externalId: null,
				sourceUrl: null,
				contentHash: 'hash-v1',
				lastImportJobId: job.id
			});

			const result = await syncMissingEntitySourceRefs(db, {
				universeId: u.id,
				sourceSystem: 'obsidian',
				touchedExternalIds: [],
				importJobId: job.id
			});
			expect(result.markedMissing).toEqual([]);
		});

		it('scopes marking to the given source system and universe, leaving another source or universe alone', async () => {
			const { universe: u, owner, job: firstJob } = await jobFixture();
			const otherUniverse = await insertHomebrewUniverse(db, { ownerUserId: owner.id });
			const sharedPath = unique('notes/shared-name.md');

			await entityWithSourceRef(u.id, 'Kanka Only', sharedPath, firstJob.id);
			const kankaRef = await db
				.select()
				.from(entitySourceRef)
				.innerJoin(entity, eq(entity.id, entitySourceRef.entityId))
				.where(eq(entity.name, 'Kanka Only'));
			await db
				.update(entitySourceRef)
				.set({ sourceSystem: 'kanka' })
				.where(eq(entitySourceRef.id, kankaRef[0]!.entity_source_ref.id));

			await entityWithSourceRef(otherUniverse.id, 'Other Universe', sharedPath, firstJob.id);

			const result = await syncMissingEntitySourceRefs(db, {
				universeId: u.id,
				sourceSystem: 'obsidian',
				touchedExternalIds: [],
				importJobId: firstJob.id
			});

			expect(result.markedMissing).toEqual([]);
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
			const { candidates, truncated } = await candidateEntitiesForMatching(db, u.id, 'character');
			expect(candidates.some((c) => c.name === 'Aldric Voss')).toBe(true);
			expect(candidates.some((c) => c.name === 'Thornwick College')).toBe(false);
			expect(truncated).toBe(false);
		});

		it('carries the type and a capped head of the body, for the matcher to embed (issue #310)', async () => {
			const { universe: u } = await jobFixture();
			const body = `${'Dismissed captain of the Valdoria Watch. '.repeat(20)}tail`;
			await db.insert(entity).values({
				universeId: u.id,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric-vane'),
				body
			});

			const { candidates } = await candidateEntitiesForMatching(db, u.id, 'character');
			const aldric = candidates.find((candidate) => candidate.name === 'Aldric Vane');
			if (!aldric) throw new Error('fixture setup failed');

			expect(aldric.type).toBe('character');
			// Cut in SQL, so a pool of two hundred entities does not ship two hundred whole bodies
			// over the wire to use the first sentence of each.
			expect(aldric.bodyLead).toBe(body.slice(0, 400));
			expect(aldric.bodyLead.length).toBeLessThan(body.length);
		});

		// Issue #627. The pool used to take an unordered LIMIT, so which entities reached the
		// scorer was whatever the heap happened to hold first: insertion order until something
		// rewrote a row, and then a different set. These twelve are inserted in an order that
		// is not their slug order, so an unordered read cannot pass.
		it('pages a pool larger than the limit in slug order rather than in insertion order', async () => {
			const { universe: u } = await jobFixture();
			const prefix = unique('pool');
			const inserted = [7, 2, 11, 0, 5, 9, 1, 6, 3, 10, 4, 8];
			await db.insert(entity).values(
				inserted.map((n) => ({
					universeId: u.id,
					type: 'character' as const,
					name: `Pool ${String(n).padStart(2, '0')}`,
					slug: `${prefix}-${String(n).padStart(2, '0')}`,
					body: ''
				}))
			);

			const first = await candidateEntitiesForMatching(db, u.id, 'character', 5);
			expect(first.candidates).toHaveLength(5);
			expect(first.truncated).toBe(true);
			expect(first.candidates.map((c) => c.name)).toEqual([
				'Pool 00',
				'Pool 01',
				'Pool 02',
				'Pool 03',
				'Pool 04'
			]);

			// And it stays that page across a rewrite of the rows in it, which is what moves a
			// tuple in the heap and used to move the page with it.
			await db
				.update(entity)
				.set({ body: 'the GM edited this' })
				.where(inArray(entity.slug, [`${prefix}-00`, `${prefix}-01`, `${prefix}-02`]));
			const second = await candidateEntitiesForMatching(db, u.id, 'character', 5);
			expect(second.candidates.map((c) => c.id)).toEqual(first.candidates.map((c) => c.id));
		});

		it('reports a pool that fits under the limit as complete', async () => {
			const { universe: u } = await jobFixture();
			await db.insert(entity).values({
				universeId: u.id,
				type: 'character',
				name: 'Solitary',
				slug: unique('solitary'),
				body: ''
			});
			const pool = await candidateEntitiesForMatching(db, u.id, 'character', 200);
			expect(pool.truncated).toBe(false);
		});
	});

	describe('entitiesByIdentity / entityUpdateTargetsByIds (issue #479)', () => {
		it('finds a collision across entity types, which is what both candidate pools are blind to', async () => {
			const { universe: u } = await jobFixture();
			await db.insert(entity).values({
				universeId: u.id,
				type: 'place',
				name: 'Cairnmouth',
				slug: 'cairnmouth',
				body: 'A fishing town two days up the coast.'
			});

			// The pool the semantic step gets, asked for the type a bad extraction proposed.
			expect((await candidateEntitiesForMatching(db, u.id, 'faction')).candidates).toEqual([]);
			// The identity lookup, which is the one that has to see it: `entity_universe_slug_key`
			// is UNIQUE on (universe_id, slug) and takes no notice of the type.
			const found = await entitiesByIdentity(db, u.id, ['cairnmouth'], []);
			expect(found.map((row) => [row.name, row.type])).toEqual([['Cairnmouth', 'place']]);
		});

		it('matches a case-folded name when the stored slug was edited away from it', async () => {
			const { universe: u } = await jobFixture();
			await db.insert(entity).values({
				universeId: u.id,
				type: 'place',
				name: 'Cairnmouth',
				slug: unique('cairnmouth-the-town'),
				body: ''
			});
			expect(await entitiesByIdentity(db, u.id, ['cairnmouth'], [])).toEqual([]);
			const byName = await entitiesByIdentity(db, u.id, ['cairnmouth'], ['CAIRNMOUTH']);
			expect(byName.map((row) => row.name)).toEqual(['Cairnmouth']);
		});

		it('never reaches out of the universe, and answers nothing for nothing', async () => {
			const { universe: u } = await jobFixture();
			const other = await jobFixture();
			await db.insert(entity).values({
				universeId: other.universe.id,
				type: 'place',
				name: 'Cairnmouth',
				slug: 'cairnmouth',
				body: ''
			});
			expect(await entitiesByIdentity(db, u.id, ['cairnmouth'], ['Cairnmouth'])).toEqual([]);
			expect(await entitiesByIdentity(db, u.id, [], [])).toEqual([]);
			expect(await entitiesByIdentity(db, u.id, [''], ['  '])).toEqual([]);
		});

		it('reads a whole body, not the capped head the matcher gets', async () => {
			const { universe: u } = await jobFixture();
			// The shape that made this query necessary: a `:::secret` sitting past
			// `candidateEntitiesForMatching`'s 400 character cut, so a guard reading the lead
			// would decide there was no secret to lose.
			const body = `${'A merchant bank that lends at knife point. '.repeat(12)}\n\n:::secret\nAldric Vane is on its payroll.\n:::`;
			expect(body.length).toBeGreaterThan(400);
			const [row] = await db
				.insert(entity)
				.values({
					universeId: u.id,
					type: 'faction',
					name: 'The Ashen Ledger',
					slug: unique('the-ashen-ledger'),
					aliases: ['The Ledger'],
					body
				})
				.returning();
			if (!row) throw new Error('fixture setup failed');

			const targets = await entityUpdateTargetsByIds(db, [row.id, row.id]);
			expect(targets.get(row.id)).toEqual({
				id: row.id,
				name: 'The Ashen Ledger',
				aliases: ['The Ledger'],
				body
			});
			expect(targets.get(row.id)?.body).toContain(':::secret');
			expect(await entityUpdateTargetsByIds(db, [])).toEqual(new Map());
		});
	});

	describe('pendingEntityProposalsForJob / foldEntitySightingIntoPendingProposal (issue #160, #178)', () => {
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

			const { candidates } = await pendingEntityProposalsForJob(db, job.id, 'character');
			// `type` and `bodyLead` are issue #310: the matcher embeds them as context, and they come
			// off the patch rather than off the caller's filter argument so a row reports what it
			// actually says.
			expect(candidates).toEqual([
				{
					id: character.id,
					name: 'Aldric Vane',
					aliases: [],
					type: 'character',
					bodyLead: 'x'
				}
			]);
		});

		it('stops returning a proposal once it is no longer pending', async () => {
			const { universe: u, job } = await jobFixture();
			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane');

			await acceptProposal(db, { proposalId: character.id });

			const { candidates } = await pendingEntityProposalsForJob(db, job.id, 'character');
			expect(candidates).toEqual([]);
		});

		// Issue #627. The type filter used to run in TypeScript, after the SQL LIMIT, so the cap
		// applied to the job's pending creates of every type and then whatever was left of the
		// requested one came back. Six characters exist here and the cap is four, so a pool that
		// filters after the limit can only return two of them.
		it('applies the limit to the requested type, not to the job (issue #627)', async () => {
			const { universe: u, job } = await jobFixture();
			for (let i = 0; i < 6; i += 1) {
				await pendingCreateCandidate(job.id, u.id, 'character', `Character ${i}`);
				await pendingCreateCandidate(job.id, u.id, 'place', `Place ${i}`);
			}

			const pool = await pendingEntityProposalsForJob(db, job.id, 'character', 4);
			expect(pool.candidates).toHaveLength(4);
			expect(pool.candidates.every((c) => c.type === 'character')).toBe(true);
			expect(pool.truncated).toBe(true);

			const whole = await pendingEntityProposalsForJob(db, job.id, 'character', 200);
			expect(whole.candidates).toHaveLength(6);
			expect(whole.truncated).toBe(false);
		});

		// Issue #627. Within one plan the order is `rank`, which decision C3 already makes the
		// ordering that survives a cap, and never the order the rows were written in. These are
		// written in reverse rank on purpose, so an unordered read cannot pass.
		it('pages a pool larger than the limit by created_at then rank, not by heap order', async () => {
			const { universe: u, job } = await jobFixture();
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'import',
				importJobId: job.id,
				summary: 'one document',
				candidateCap: 10,
				estimatedCredits: 0,
				candidates: Array.from({ length: 6 }, (_, i) => ({
					kind: 'create' as const,
					targetEntityId: null,
					rationale: 'r',
					evidence: [],
					rank: 5 - i
				}))
			});
			for (const [i, created] of proposals.entries()) {
				await recordProposalDiff(db, {
					proposalId: created.id,
					patch: {
						type: 'character',
						name: `Rank ${5 - i}`,
						slug: unique(`rank-${5 - i}`),
						aliases: [],
						body: 'x'
					},
					provider: 'test',
					modelId: 'test',
					credits: 0
				});
			}

			const pool = await pendingEntityProposalsForJob(db, job.id, 'character', 3);
			expect(pool.candidates.map((c) => c.name)).toEqual(['Rank 0', 'Rank 1', 'Rank 2']);

			// A fold rewrites the proposal's patch, which relocates the row. Measured on a
			// notebook-shaped job, 20 folds moved 19 of a 200 row page: the pool a fold decision
			// was scored against changed because of the previous fold.
			await foldEntitySightingIntoPendingProposal(db, {
				proposalId: pool.candidates[0]!.id,
				names: ['A Second Sighting'],
				documentId: 'doc-2',
				sourceRef: { documentId: 'doc-2', path: 'notes/second.md' },
				contentHash: 'hash-doc-2'
			});
			const after = await pendingEntityProposalsForJob(db, job.id, 'character', 3);
			expect(after.candidates.map((c) => c.id)).toEqual(pool.candidates.map((c) => c.id));
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
				names: ['Aldric Vane', 'Al', 'Captain Vane'],
				documentId: 'doc-2',
				sourceRef: { documentId: 'doc-2', path: 'notes/aldric-2.md' },
				contentHash: 'hash-doc-2'
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
				names: ['A Name That Should Never Land'],
				documentId: 'doc-2',
				sourceRef: { documentId: 'doc-2', path: 'notes/never.md' },
				contentHash: 'hash-never'
			});

			const row = await getProposal(db, character.id);
			expect(row?.outcome).toBe('accepted');
			expect(row?.patch).toMatchObject({ aliases: [] });
		});

		it("records the folding document's sourceRef/contentHash onto the proposal's evidence, for a later entity_source_ref of its own (issue #178)", async () => {
			const { universe: u, job } = await jobFixture();
			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane');

			await foldEntitySightingIntoPendingProposal(db, {
				proposalId: character.id,
				names: ['Aldric Vane'],
				documentId: 'doc-2',
				sourceRef: { documentId: 'doc-2', path: 'notes/aldric-2.md' },
				contentHash: 'hash-doc-2'
			});

			const row = await getProposal(db, character.id);
			expect(row?.evidence).toMatchObject({
				foldedSources: [
					{
						documentId: 'doc-2',
						sourceRef: { documentId: 'doc-2', path: 'notes/aldric-2.md' },
						contentHash: 'hash-doc-2'
					}
				]
			});
		});

		it('does not duplicate a document that folds into the same proposal twice', async () => {
			const { universe: u, job } = await jobFixture();
			const character = await pendingCreateCandidate(job.id, u.id, 'character', 'Aldric Vane');
			const fold = () =>
				foldEntitySightingIntoPendingProposal(db, {
					proposalId: character.id,
					names: ['Aldric Vane'],
					documentId: 'doc-2',
					sourceRef: { documentId: 'doc-2', path: 'notes/aldric-2.md' },
					contentHash: 'hash-doc-2'
				});

			await fold();
			await fold();

			const row = await getProposal(db, character.id);
			const evidence = row?.evidence as { foldedSources?: unknown[] };
			expect(evidence.foldedSources).toHaveLength(1);
		});
	});

	describe('pendingEntityProposalsByIdentity (issues #479, #627)', () => {
		async function pendingCreate(
			jobId: string,
			universeId: string,
			type: 'character' | 'place',
			name: string,
			slug: string
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
				patch: { type, name, slug, aliases: [], body: 'x' },
				provider: 'test',
				modelId: 'test',
				credits: 0
			});
			return created;
		}

		it('finds the collision however deep in the job it sits, with no cap to fall outside of', async () => {
			const { universe: u, job } = await jobFixture();
			for (let i = 0; i < 8; i += 1) {
				await pendingCreate(job.id, u.id, 'character', `Filler ${i}`, unique(`filler-${i}`));
			}
			// Written last, so a query that read a page of the job's creates and filtered it in
			// TypeScript would have to be paging deep enough to reach it.
			const cairnmouth = await pendingCreate(job.id, u.id, 'place', 'Cairnmouth', 'cairnmouth');

			const found = await pendingEntityProposalsByIdentity(db, job.id, ['cairnmouth'], []);
			expect(found).toEqual([
				{ id: cairnmouth.id, name: 'Cairnmouth', slug: 'cairnmouth', type: 'place' }
			]);
		});

		it('is type-blind, because entity_universe_slug_key is (issue #479)', async () => {
			const { universe: u, job } = await jobFixture();
			const place = await pendingCreate(job.id, u.id, 'place', 'Saltmere', 'saltmere');
			// A later document proposes the same name as a faction. The slug is the same string,
			// and the constraint takes no notice of the type.
			const found = await pendingEntityProposalsByIdentity(db, job.id, ['saltmere'], []);
			expect(found.map((row) => [row.id, row.type])).toEqual([[place.id, 'place']]);
		});

		it('matches a case-folded name as well as a slug, and returns the patch\u2019s own slug', async () => {
			const { universe: u, job } = await jobFixture();
			// A hand-written slug that `slugify(name)` would not produce, which is the case the
			// name half of the lookup exists for.
			const row = await pendingCreate(job.id, u.id, 'place', 'Cairnmouth', 'cairnmouth-the-town');
			expect(await pendingEntityProposalsByIdentity(db, job.id, ['cairnmouth'], [])).toEqual([]);
			const byName = await pendingEntityProposalsByIdentity(db, job.id, [], ['CAIRNMOUTH']);
			expect(byName).toEqual([
				{ id: row.id, name: 'Cairnmouth', slug: 'cairnmouth-the-town', type: 'place' }
			]);
		});

		it("ignores another job's creates, an already decided one, and a patch with no name yet", async () => {
			const { universe: u, job } = await jobFixture();
			const { job: otherJob } = await jobFixture();
			await pendingCreate(otherJob.id, u.id, 'place', 'Cairnmouth', 'cairnmouth');
			const accepted = await pendingCreate(job.id, u.id, 'place', 'Saltmere', 'saltmere');
			await acceptProposal(db, { proposalId: accepted.id });
			// `patch: {}` until recordProposalDiff runs, which is a real window during a job.
			await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'import',
				importJobId: job.id,
				summary: 'x',
				candidateCap: 10,
				estimatedCredits: 0,
				candidates: [
					{ kind: 'create', targetEntityId: null, rationale: 'r', evidence: [], rank: 0 }
				]
			});

			expect(
				await pendingEntityProposalsByIdentity(db, job.id, ['cairnmouth', 'saltmere'], [])
			).toEqual([]);
		});

		it('asks nothing when there is nothing to ask about', async () => {
			const { job } = await jobFixture();
			expect(await pendingEntityProposalsByIdentity(db, job.id, [], [])).toEqual([]);
			expect(await pendingEntityProposalsByIdentity(db, job.id, [''], ['  '])).toEqual([]);
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

		it('gives every document that folded into this proposal its own entity_source_ref row once accepted (issue #178)', async () => {
			const { universe: u, job } = await jobFixture();
			const slug = unique('aldric-voss');
			const { proposals } = await createProposalPlan(db, {
				universeId: u.id,
				trigger: 'import',
				importJobId: job.id,
				summary: 'Import: 1 new entity',
				candidateCap: 10,
				estimatedCredits: 0,
				candidates: [
					{ kind: 'create', targetEntityId: null, rationale: 'r', evidence: [], rank: 0 }
				]
			});
			const created = proposals[0];
			if (!created) throw new Error('fixture setup failed');
			await recordProposalDiff(db, {
				proposalId: created.id,
				patch: { type: 'character', name: 'Aldric Voss', slug, aliases: [], body: 'x' },
				provider: 'test',
				modelId: 'test',
				credits: 0
			});

			// A second document's sighting of the same entity folded into this proposal
			// before accept (foldEntitySightingIntoPendingProposal, issue #160) - its own
			// path never becomes evidence.sourceRef, only evidence.foldedSources.
			await foldEntitySightingIntoPendingProposal(db, {
				proposalId: created.id,
				names: ['Aldric Voss'],
				documentId: 'doc-2',
				sourceRef: { documentId: 'doc-2', path: 'notes/aldric-2.md' },
				contentHash: 'hash-doc-2'
			});

			const accepted = await acceptImportProposal(db, {
				proposalId: created.id,
				sourceSystem: 'obsidian',
				externalId: 'notes/aldric-1.md',
				sourceUrl: null,
				contentHash: 'hash-doc-1',
				importJobId: job.id
			});
			expect(accepted.outcome).toBe('accepted');

			const primary = await findEntityBySourceRef(db, u.id, 'obsidian', 'notes/aldric-1.md');
			expect(primary?.contentHash).toBe('hash-doc-1');

			const folded = await findEntityBySourceRef(db, u.id, 'obsidian', 'notes/aldric-2.md');
			expect(folded).not.toBeNull();
			expect(folded?.contentHash).toBe('hash-doc-2');
			expect(folded?.entityId).toBe(primary?.entityId);
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
