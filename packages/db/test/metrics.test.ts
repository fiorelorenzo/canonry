/**
 * SPEC.md §14, issues #100, #101, #102, #103: the four metrics queries behind the admin
 * dashboard (apps/web's /admin/metrics) and the warm radius governor (@canonry/warm's
 * radius.ts). Every empty-state assertion here backs the acceptance criteria's "honest
 * empty state" requirement directly - a fresh universe must read as "no data", never 0%.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	importsToFirstAcceptedProposal,
	proposalOutcomesForMetrics,
	sessionEntropyMetrics,
	warmHitRate,
	type Db
} from '../src/index.js';
import { entity } from '../src/schema/entity.js';
import { proposal } from '../src/schema/proposal.js';
import { revision } from '../src/schema/revision.js';
import { importJob } from '../src/schema/source.js';
import { sessionContext, warmArtifact } from '../src/schema/table.js';
import { insertHomebrewUniverse, insertUser, testDb, unique } from './helpers.js';

describe('metrics queries', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function insertEntity(
		universeId: string,
		overrides: Partial<typeof entity.$inferInsert> = {}
	) {
		const slug = unique('entity');
		const [row] = await db
			.insert(entity)
			.values({ universeId, type: 'place', name: slug, slug, ...overrides })
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		return row;
	}

	async function insertRevision(
		overrides: Partial<typeof revision.$inferInsert> & { universeId: string; entityId: string }
	) {
		const [row] = await db
			.insert(revision)
			.values({ authorKind: 'human', name: 'r', body: unique('body'), ...overrides })
			.returning();
		if (!row) throw new Error('revision insert returned no row');
		return row;
	}

	async function insertProposal(
		overrides: Partial<typeof proposal.$inferInsert> & { universeId: string }
	) {
		const [row] = await db
			.insert(proposal)
			.values({
				trigger: 'save',
				kind: 'update',
				patch: {},
				outcome: 'pending',
				...overrides
			})
			.returning();
		if (!row) throw new Error('proposal insert returned no row');
		return row;
	}

	describe('proposalOutcomesForMetrics (#100)', () => {
		it('returns an empty array for a universe with no proposals, never a fabricated rate', async () => {
			const u = await insertHomebrewUniverse(db);
			const rows = await proposalOutcomesForMetrics(db, { universeId: u.id, sinceDays: 0 });
			expect(rows).toEqual([]);
		});

		it('carries outcome, kind and model for every proposal in the window, pending and superseded included', async () => {
			const u = await insertHomebrewUniverse(db);
			await insertProposal({
				universeId: u.id,
				outcome: 'accepted',
				kind: 'update',
				modelId: 'gpt-a'
			});
			await insertProposal({
				universeId: u.id,
				outcome: 'rejected',
				kind: 'update',
				modelId: 'gpt-a'
			});
			await insertProposal({
				universeId: u.id,
				outcome: 'pending',
				kind: 'create',
				modelId: 'gpt-b'
			});
			await insertProposal({
				universeId: u.id,
				outcome: 'superseded',
				kind: 'relation',
				modelId: null
			});

			const rows = await proposalOutcomesForMetrics(db, { universeId: u.id, sinceDays: 0 });

			expect(rows).toHaveLength(4);
			expect(rows.map((r) => r.outcome).sort()).toEqual([
				'accepted',
				'pending',
				'rejected',
				'superseded'
			]);
			expect(rows.find((r) => r.outcome === 'accepted')?.modelId).toBe('gpt-a');
			expect(rows.find((r) => r.outcome === 'pending')?.modelId).toBe('gpt-b');
		});

		it('excludes proposals older than the requested window', async () => {
			const u = await insertHomebrewUniverse(db);
			const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
			await insertProposal({ universeId: u.id, outcome: 'accepted', createdAt: old });
			await insertProposal({ universeId: u.id, outcome: 'accepted' });

			const rows = await proposalOutcomesForMetrics(db, { universeId: u.id, sinceDays: 90 });

			expect(rows).toHaveLength(1);
		});
	});

	describe('importsToFirstAcceptedProposal (#101)', () => {
		async function insertImportJob(universeId: string, createdAt: Date) {
			const [row] = await db
				.insert(importJob)
				.values({
					universeId,
					sourceType: 'generic',
					playbook: 'generic',
					playbookVersion: 1,
					artefactPath: `s3://imports/${unique('artefact')}.zip`,
					artefactSha256: 'a'.repeat(64),
					createdAt
				})
				.returning();
			if (!row) throw new Error('import job insert returned no row');
			return row;
		}

		it('reports null when an import has no accepted proposal yet, not zero seconds', async () => {
			const u = await insertHomebrewUniverse(db);
			const job = await insertImportJob(u.id, new Date());

			const rows = await importsToFirstAcceptedProposal(db, { universeId: u.id });

			expect(rows).toHaveLength(1);
			expect(rows[0]?.importJobId).toBe(job.id);
			expect(rows[0]?.firstAcceptedAt).toBeNull();
			expect(rows[0]?.secondsToFirstAccept).toBeNull();
		});

		it('measures the delta to the earliest accepted proposal attributed to that import', async () => {
			const u = await insertHomebrewUniverse(db);
			const importedAt = new Date('2026-01-01T10:00:00Z');
			const job = await insertImportJob(u.id, importedAt);
			// Later proposal from the same run, accepted second - must not win over the earlier one.
			await insertProposal({
				universeId: u.id,
				trigger: 'import',
				outcome: 'accepted',
				createdAt: new Date('2026-01-01T10:05:00Z'),
				decidedAt: new Date('2026-01-01T10:20:00Z')
			});
			await insertProposal({
				universeId: u.id,
				trigger: 'import',
				outcome: 'accepted',
				createdAt: new Date('2026-01-01T10:01:00Z'),
				decidedAt: new Date('2026-01-01T10:06:12Z')
			});

			const rows = await importsToFirstAcceptedProposal(db, { universeId: u.id });

			expect(rows[0]?.secondsToFirstAccept).toBe(6 * 60 + 12);
		});

		it("never attributes a later import job's proposals to an earlier job", async () => {
			const u = await insertHomebrewUniverse(db);
			const firstJob = await insertImportJob(u.id, new Date('2026-01-01T09:00:00Z'));
			await insertImportJob(u.id, new Date('2026-01-01T11:00:00Z'));
			// Belongs to the second job's window, not the first's.
			await insertProposal({
				universeId: u.id,
				trigger: 'import',
				outcome: 'accepted',
				createdAt: new Date('2026-01-01T11:05:00Z'),
				decidedAt: new Date('2026-01-01T11:10:00Z')
			});

			const rows = await importsToFirstAcceptedProposal(db, { universeId: u.id });
			const firstRow = rows.find((r) => r.importJobId === firstJob.id);

			expect(firstRow?.firstAcceptedAt).toBeNull();
		});
	});

	describe('warmHitRate (#102)', () => {
		it('reports a null rate for a universe with nothing generated yet', async () => {
			const u = await insertHomebrewUniverse(db);
			const result = await warmHitRate(db, u.id);
			expect(result).toEqual({ consumed: 0, generated: 0, hitRate: null });
		});

		it('divides consumed over generated across every warm_artifact row', async () => {
			const u = await insertHomebrewUniverse(db);
			await db.insert(warmArtifact).values([
				{
					universeId: u.id,
					kind: 'brief',
					payload: {},
					fingerprint: unique('fp'),
					consumedCount: 3
				},
				{
					universeId: u.id,
					kind: 'brief',
					payload: {},
					fingerprint: unique('fp'),
					consumedCount: 1
				},
				{
					universeId: u.id,
					kind: 'brief',
					payload: {},
					fingerprint: unique('fp'),
					consumedCount: 0
				}
			]);

			const result = await warmHitRate(db, u.id);

			expect(result.generated).toBe(3);
			expect(result.consumed).toBe(4);
			expect(result.hitRate).toBeCloseTo(4 / 3, 5);
		});
	});

	describe('sessionEntropyMetrics (#103)', () => {
		it('reports zero for both counters on a universe with no sessions or entries', async () => {
			const u = await insertHomebrewUniverse(db);
			const rows = await sessionEntropyMetrics(db);
			const row = rows.find((r) => r.universeId === u.id);
			expect(row).toBeDefined();
			expect(row?.entriesCreatedInPrep).toBe(0);
			expect(row?.entriesUpdatedAfterSession).toBe(0);
		});

		it('counts an entity created outside any session window as prep, and one created during a session as not', async () => {
			const u = await insertHomebrewUniverse(db);
			const sessionStart = new Date('2026-02-01T18:00:00Z');
			const sessionEnd = new Date('2026-02-01T21:00:00Z');
			await db.insert(sessionContext).values({
				universeId: u.id,
				startedAt: sessionStart,
				endedAt: sessionEnd
			});

			await insertEntity(u.id, { createdAt: new Date('2026-01-30T10:00:00Z') }); // prep, before the session
			await insertEntity(u.id, { createdAt: new Date('2026-02-01T19:00:00Z') }); // during the session

			const rows = await sessionEntropyMetrics(db);
			const row = rows.find((r) => r.universeId === u.id);

			expect(row?.entriesCreatedInPrep).toBe(1);
		});

		it('counts an entity update inside the debrief window after a session, and excludes one made long after', async () => {
			const u = await insertHomebrewUniverse(db);
			const owner = await insertUser(db);
			const sessionEnd = new Date('2026-02-01T21:00:00Z');
			await db.insert(sessionContext).values({
				universeId: u.id,
				startedAt: new Date('2026-02-01T18:00:00Z'),
				endedAt: sessionEnd
			});

			const debriefed = await insertEntity(u.id);
			const untouched = await insertEntity(u.id);

			// First revision on each - the entity's creation, not an update.
			const initialDebriefed = await insertRevision({
				universeId: u.id,
				entityId: debriefed.id,
				authorUserId: owner.id,
				createdAt: new Date('2026-01-25T00:00:00Z')
			});
			const initialOther = await insertRevision({
				universeId: u.id,
				entityId: untouched.id,
				authorUserId: owner.id,
				createdAt: new Date('2026-01-25T00:00:00Z')
			});

			// An update the next morning after the session - inside the debrief window.
			await insertRevision({
				universeId: u.id,
				entityId: debriefed.id,
				parentRevisionId: initialDebriefed.id,
				authorUserId: owner.id,
				createdAt: new Date('2026-02-02T09:00:00Z')
			});
			// An update three weeks later - well past the one-week debrief window.
			await insertRevision({
				universeId: u.id,
				entityId: untouched.id,
				parentRevisionId: initialOther.id,
				authorUserId: owner.id,
				createdAt: new Date('2026-02-25T09:00:00Z')
			});

			const rows = await sessionEntropyMetrics(db);
			const row = rows.find((r) => r.universeId === u.id);

			expect(row?.entriesUpdatedAfterSession).toBe(1);
		});
	});
});
