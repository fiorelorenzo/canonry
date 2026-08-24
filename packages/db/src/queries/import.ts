// SPEC.md §4.6, §6.4, §6.7, issues #26, #27, #29, #30, #36. The database side of the
// import job lifecycle: the queue and concurrency admission, checkpoint persistence,
// exactly-once settlement, per-user quota reads, and the entity_source_ref bookkeeping
// that makes a second import of the same export a no-op. Proposal content itself still
// goes exclusively through proposals.ts's createProposalPlan/recordProposalDiff/
// acceptProposal - "nothing else in the codebase may write canon from a proposal" holds
// here too, this file only adds the import-specific bookkeeping (entity_source_ref)
// around that boundary.
import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lt,
	notInArray,
	or,
	sql
} from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType, ImportJobStatus, RelationCardinality } from '../schema/enums.js';
import { relationType } from '../schema/relation.js';
import { proposal, proposalPlan } from '../schema/proposal.js';
import { revision } from '../schema/revision.js';
import { entitySourceRef, importJob } from '../schema/source.js';
import { userBilling } from '../schema/billing.js';
import { ensureBilling } from './billing.js';
import {
	acceptProposal,
	createProposalPlan,
	readEntityCreatePatch,
	reconcileRelationEndpoints,
	recordProposalDiff,
	ProposalAlreadyDecidedError,
	ProposalNotFoundError,
	type AcceptProposalInput,
	type ProposalRow
} from './proposals.js';

export type ImportJobRow = typeof importJob.$inferSelect;
export type EntitySourceRefRow = typeof entitySourceRef.$inferSelect;

export class ImportJobNotFoundError extends Error {
	constructor(jobId: string) {
		super(`no import_job row for id "${jobId}"`);
		this.name = 'ImportJobNotFoundError';
	}
}

// ---------------------------------------------------------------------------
// Job lifecycle (issue #26: "a job has its own timeout independent of the browser
// session, can be cancelled, and settles exactly once").
// ---------------------------------------------------------------------------

export interface CreateImportJobInput {
	universeId: string;
	createdBy: string | null;
	sourceType: string;
	playbook: string;
	playbookVersion: number;
	artefactPath: string;
	artefactBytes: number;
	artefactSha256: string;
	documentCount: number;
	budgetCredits: number;
}

/** Always inserted as `queued` - admission into `running` is a separate, concurrency-
 * checked step (`admitImportJob`), never implicit in creation. */
export async function createImportJob(db: Db, input: CreateImportJobInput): Promise<ImportJobRow> {
	const [row] = await db
		.insert(importJob)
		.values({ ...input, status: 'queued' })
		.returning();
	if (!row) throw new Error('createImportJob: insert returned no row');
	return row;
}

export async function getImportJob(db: Db, jobId: string): Promise<ImportJobRow> {
	const [row] = await db.select().from(importJob).where(eq(importJob.id, jobId)).limit(1);
	if (!row) throw new ImportJobNotFoundError(jobId);
	return row;
}

/** Every import job this universe has run, whatever its status, newest first - issue
 * R11 (round thirteen)'s `/w/[universe]/import` index: "lists the jobs it has already
 * run with their status and their review link." `getImportJob` above answers for one
 * job by id; this is the index that page reads. */
export async function importJobsForUniverse(db: Db, universeId: string): Promise<ImportJobRow[]> {
	return db
		.select()
		.from(importJob)
		.where(eq(importJob.universeId, universeId))
		.orderBy(desc(importJob.createdAt));
}

export async function countRunningImportJobs(db: Db): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(importJob)
		.where(eq(importJob.status, 'running'));
	return row?.n ?? 0;
}

/** 1-based position among jobs still queued, oldest first; 0 for a job that is not
 * queued (already running, or already settled). An estimate for the GM (SPEC.md §6.7:
 * "third in queue"), not a guarantee - it can move between reads under concurrent
 * admissions, same as any queue position ever shown to a user. */
export async function queuePositionFor(db: Db, jobId: string): Promise<number> {
	const job = await getImportJob(db, jobId);
	if (job.status !== 'queued') return 0;
	const [row] = await db
		.select({ n: count() })
		.from(importJob)
		.where(and(eq(importJob.status, 'queued'), lt(importJob.createdAt, job.createdAt)));
	return (row?.n ?? 0) + 1;
}

export interface AdmitResult {
	admitted: boolean;
	job: ImportJobRow;
}

/** issue #26/#30: the queue's admission check - a global concurrency cap, checked and
 * applied atomically (`SELECT ... FOR UPDATE` on the job row, then a count of running
 * jobs in the same transaction) so two concurrent admission attempts can never both slip
 * past the limit. A job that is not `queued` is returned unchanged - idempotent, so a
 * caller can retry admission freely. */
export async function admitImportJob(
	db: Db,
	jobId: string,
	concurrencyLimit: number
): Promise<AdmitResult> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(importJob)
			.where(eq(importJob.id, jobId))
			.for('update')
			.limit(1);
		if (!locked) throw new ImportJobNotFoundError(jobId);
		if (locked.status !== 'queued') {
			return { admitted: locked.status === 'running', job: locked };
		}

		const [runningRow] = await tx
			.select({ n: count() })
			.from(importJob)
			.where(eq(importJob.status, 'running'));
		if ((runningRow?.n ?? 0) >= concurrencyLimit) {
			return { admitted: false, job: locked };
		}

		const [updated] = await tx
			.update(importJob)
			.set({ status: 'running', startedAt: new Date() })
			.where(eq(importJob.id, jobId))
			.returning();
		if (!updated) throw new Error('admitImportJob: update returned no row');
		return { admitted: true, job: updated };
	});
}

export interface CheckpointUpdate {
	/** Shape is the driver's (driver.ts's `DocumentRunContext`-derived cursor); this
	 * column does not interpret it, only stores it (source.ts's own schema comment). */
	checkpoint: unknown;
	spentCreditsDelta: number;
	inputTokensDelta: number;
	outputTokensDelta: number;
}

/** issue #27: "progress is checkpointed per document, so a crash costs one document
 * rather than an afternoon." Called after every document settles (or after every step,
 * for a caller that wants finer-grained resume) - `checkpoint` always replaces the
 * column wholesale, the token/credit deltas accumulate. */
export async function updateImportJobCheckpoint(
	db: Db,
	jobId: string,
	update: CheckpointUpdate
): Promise<ImportJobRow> {
	const current = await getImportJob(db, jobId);
	const [updated] = await db
		.update(importJob)
		.set({
			checkpoint: update.checkpoint,
			spentCredits: current.spentCredits + update.spentCreditsDelta,
			inputTokens: current.inputTokens + update.inputTokensDelta,
			outputTokens: current.outputTokens + update.outputTokensDelta
		})
		.where(eq(importJob.id, jobId))
		.returning();
	if (!updated) throw new ImportJobNotFoundError(jobId);
	return updated;
}

// 'stopped_at_ceiling' is deliberately not here: SPEC.md §6.7 makes it resumable ("stops
// cleanly... and asks whether to continue"), so a later resume run has to be able to
// settle the same job again, to 'finished' or to a second 'stopped_at_ceiling'. Only
// 'finished', 'cancelled' and 'failed' are truly final - a job in one of those never
// settles again, which is what "settles exactly once" (issue #26) actually protects:
// a cancel racing a natural finish within one run, not a deliberate resume across runs.
const FINAL_STATUSES: readonly ImportJobStatus[] = ['finished', 'cancelled', 'failed'];

export interface SettleImportJobInput {
	status: 'finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed';
	outcomeNote: string;
	proposalsEmitted: number;
}

export interface SettleResult {
	/** False when the job was already terminal - the exactly-once guarantee issue #26
	 * asks for: a second settlement attempt (e.g. a cancel racing a natural finish)
	 * changes nothing and reports which outcome actually won. */
	settled: boolean;
	job: ImportJobRow;
}

/** issue #26: "settles exactly once." Locks the row, refuses to move a job that is
 * already in one of the terminal statuses, and returns the row either way so a caller
 * that lost the race still sees the real, final state. */
export async function settleImportJob(
	db: Db,
	jobId: string,
	input: SettleImportJobInput
): Promise<SettleResult> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(importJob)
			.where(eq(importJob.id, jobId))
			.for('update')
			.limit(1);
		if (!locked) throw new ImportJobNotFoundError(jobId);
		if (FINAL_STATUSES.includes(locked.status)) {
			return { settled: false, job: locked };
		}

		const [updated] = await tx
			.update(importJob)
			.set({
				status: input.status,
				outcomeNote: input.outcomeNote,
				proposalsEmitted: input.proposalsEmitted,
				finishedAt: new Date()
			})
			.where(eq(importJob.id, jobId))
			.returning();
		if (!updated) throw new Error('settleImportJob: update returned no row');
		return { settled: true, job: updated };
	});
}

// ---------------------------------------------------------------------------
// Quota (issue #30: "a per-user quota in jobs and documents as well as in currency").
// ---------------------------------------------------------------------------

export interface ImportUsage {
	jobCount: number;
	documentCount: number;
}

/** Usage is counted from `import_job` rows rather than kept as a running total on
 * `user_billing` (the schema comment on `import_jobs_quota` explains why: "a cancelled
 * job cannot leak quota" this way). Counts every job the user created since `since`,
 * regardless of outcome - a cancelled or failed job still consumed a queue slot and
 * real work, which is what the quota exists to bound. */
export async function importUsageForUser(
	db: Db,
	userId: string,
	since: Date
): Promise<ImportUsage> {
	const [row] = await db
		.select({
			jobCount: count(),
			documentCount: sql<number>`coalesce(sum(${importJob.documentCount}), 0)::int`
		})
		.from(importJob)
		.where(and(eq(importJob.createdBy, userId), gte(importJob.createdAt, since)));
	return { jobCount: row?.jobCount ?? 0, documentCount: row?.documentCount ?? 0 };
}

export interface ImportQuota {
	jobsQuota: number | null;
	documentsQuota: number | null;
	periodStart: Date;
}

/** Ensures a `user_billing` row exists first (issue #88's `ensureBilling` - a brand new
 * account has no cap otherwise), then reads the import-specific quota columns. `null`
 * means no cap of that kind, never "unlimited" - the currency ceiling and the queue
 * still apply either way (the schema comment on `import_jobs_quota` says this too). */
export async function importQuotaForUser(db: Db, userId: string): Promise<ImportQuota> {
	await ensureBilling(db, userId);
	const [row] = await db
		.select({
			jobsQuota: userBilling.importJobsQuota,
			documentsQuota: userBilling.importDocumentsQuota,
			periodStart: userBilling.periodStart
		})
		.from(userBilling)
		.where(eq(userBilling.userId, userId))
		.limit(1);
	if (!row)
		throw new Error(`importQuotaForUser: no user_billing row for "${userId}" after ensureBilling`);
	return row;
}

export interface ImportQuotaCheckInput {
	quota: ImportQuota;
	usage: ImportUsage;
	availableCredits: number;
	estimate: { documentCount: number; estimatedCredits: number };
}

export type ImportQuotaCheckResult =
	| { allowed: true }
	| { allowed: false; reason: 'jobs_quota' | 'documents_quota' | 'insufficient_credits' };

/** Pure (no I/O) so the three refusal reasons are unit-testable without a database - the
 * three inputs (`quota`, `usage`, `availableCredits`) are each one read (`importQuotaFor
 * User`, `importUsageForUser`, `getBalance`), kept separate from this decision on
 * purpose. Checked once per job at admission time, alongside the queue/concurrency
 * check, not per document - a job already admitted is not retroactively refused because
 * a sibling job spent the balance in the meantime (SPEC.md §6.7's "estimate before the
 * run", not a live per-step gate). */
export function checkImportQuota(input: ImportQuotaCheckInput): ImportQuotaCheckResult {
	if (input.quota.jobsQuota !== null && input.usage.jobCount + 1 > input.quota.jobsQuota) {
		return { allowed: false, reason: 'jobs_quota' };
	}
	if (
		input.quota.documentsQuota !== null &&
		input.usage.documentCount + input.estimate.documentCount > input.quota.documentsQuota
	) {
		return { allowed: false, reason: 'documents_quota' };
	}
	if (input.availableCredits < input.estimate.estimatedCredits) {
		return { allowed: false, reason: 'insufficient_credits' };
	}
	return { allowed: true };
}

// ---------------------------------------------------------------------------
// Entity source references (issues #36, #37, SPEC.md §4.2, §6.4).
// ---------------------------------------------------------------------------

export interface EntitySourceRefMatch {
	entityId: string;
	name: string;
	aliases: string[];
	type: EntityType;
	contentHash: string;
}

/** SPEC.md §6.4 step 1: "external id - exact, free, no model involved." Scoped to
 * `universeId` even though `(sourceSystem, externalId)` is already globally unique
 * (SPEC.md §6.5: "every tool call is checked against the job's universe") - belt and
 * braces against a job somehow being handed another universe's id. */
export async function findEntityBySourceRef(
	db: Db,
	universeId: string,
	sourceSystem: string,
	externalId: string
): Promise<EntitySourceRefMatch | null> {
	const [row] = await db
		.select({
			entityId: entity.id,
			name: entity.name,
			aliases: entity.aliases,
			type: entity.type,
			contentHash: entitySourceRef.contentHash
		})
		.from(entitySourceRef)
		.innerJoin(entity, eq(entity.id, entitySourceRef.entityId))
		.where(
			and(
				eq(entitySourceRef.sourceSystem, sourceSystem),
				eq(entitySourceRef.externalId, externalId),
				eq(entity.universeId, universeId)
			)
		)
		.limit(1);
	return row ?? null;
}

export interface MatchCandidateRow {
	id: string;
	name: string;
	aliases: string[];
	/** The entity's own type (issue #310). The pool is already filtered to one type, so this
	 * is never what narrows it: it is context the matcher embeds, and it is on the row rather
	 * than taken from the caller's filter argument so a pending-proposal row read back out of
	 * a patch reports what the patch actually said. */
	type: EntityType;
	/** The head of `entity.body`, capped in SQL rather than read whole (issue #310). The
	 * matcher wants one line to tell a father from his son and reads the first sentence out of
	 * this; a pool is up to 200 rows wide, and shipping 200 full entity bodies over the wire
	 * to use the first sentence of each would be the expensive way to get the same string.
	 * Empty for an entity with no body yet, which is a real state: a `draft_entity` proposal
	 * accepted before anybody wrote its prose. */
	bodyLead: string;
}

/** How much of `entity.body` `candidateEntitiesForMatching` reads. Comfortably more than
 * one sentence, so the sentence split has something to split, and far short of a whole
 * entry. */
const BODY_LEAD_CHARS = 400;

/** A capped candidate pool, and whether the cap cut it short (issue #627).
 *
 * `truncated` is carried rather than left for the caller to infer from `candidates.length
 * === limit`, because for the pending pool those two are not the same question: rows are
 * counted before the patch of each one is parsed, so a pool can come back short of the
 * limit and still have been cut. A fold decision taken against a truncated pool is a
 * weaker decision than one taken against a complete pool, and the caller is the only place
 * that can say so. */
export interface MatchCandidatePool {
	candidates: MatchCandidateRow[];
	truncated: boolean;
}

/** The semantic step's candidate pool (SPEC.md §6.4 step 2): existing entities in the
 * same universe and of the same type as the proposed one, narrowed no further here -
 * matching.ts's own cheap pre-filter (`preFilterCandidates`) does the rest before any
 * embedding call.
 *
 * **Ordered by slug, and the ordering is not a free choice (issue #627).** An unordered
 * `LIMIT` returns whatever the heap happens to hold first, so which 200 of a large
 * universe reach the scorer moved every time a row was rewritten, and two runs of the
 * same import could fold differently for no reason a GM could see. `slug` is unique per
 * universe, so ordering by it is total and settled by the content rather than by a random
 * uuid, and `entity_universe_slug_key` is `(universe_id, slug)`, so the index serves the
 * order and the read still stops at the cap: measured on a 3000-entity universe, 129
 * buffers and 0.97ms against the unordered scan's 420 and 1.93ms. Every ordering with a
 * claim to matching relevance that I measured (`lower(name)`, `updated_at desc`) turns
 * that early stop into a full scan of the universe plus a top-N sort (300 buffers, 2.9ms
 * at 3000 entities, and it grows with the universe rather than with the cap), which is
 * the cost the cap exists to bound.
 *
 * **And it stays slug, measured (issue #641).** #627 left open whether the surviving 200
 * should be the alphabetically first or the 200 most likely to be right, with the §6.4
 * benchmark named as the way to settle it. `packages/bench`'s `pool-ordering` runner is that
 * measurement and the answer is no, for a reason that is not the plan cost.
 *
 * Cost first, because it turned out not to be the objection. `ORDER BY similarity(name, $1)
 * DESC` is a sequential scan plus a top-N sort whatever indexes exist, and a GIN trigram
 * index does not help an ordering at all, but `ORDER BY name <-> $1` against a multicolumn
 * GiST on `(universe_id, type, name gist_trgm_ops)` is an index scan: on a 3000-entity
 * six-type universe, 198 buffers and 0.88ms, against this query's own 1158 and 0.53ms,
 * because the type predicate is not in `entity_universe_slug_key` and an index scan on it
 * walks past five other types to fill one page. So a proximity ordering can be made
 * index-backed and cheaper in buffers than this one. A GiST on `name` alone is the trap in
 * that family: 2051 buffers, because the index carries neither predicate. And #627's own
 * write-up of the sequential-scan orderings is too kind to them: a `Seq Scan` here reads
 * every row of `entity` in every universe, 54 buffers at a 3000-row table and 107 at 6000,
 * so their cost grows with the deployment rather than with the universe.
 *
 * What decides it is that trigram distance is blind to the candidates this ordering would be
 * introduced to rescue. The pool's order only changes an outcome for a candidate the layer
 * above cannot rank, and that layer is `preFilterCandidates`, which sorts by name and alias
 * token overlap and breaks ties on the input order: a candidate sharing one token with the
 * subject beats every candidate sharing none regardless of where the pool put it. So the
 * order decides among candidates sharing no token with the subject, which in the labelled
 * corpus is the translated names ("Il Ratto Dorato" against "the Gilded Rat", "il Patto di
 * Cenere" against "the Ashen Covenant"), and those share no trigrams either. Scored over the
 * corpus at 209 entities of one type, slug loses two of the nine true candidates and trigram
 * proximity loses one, both to the pre-filter rather than to this cap.
 *
 * The one place the caps do bite hard is a universe far past them: at 1009 entities of one
 * type, slug never scores six of the nine and trigram proximity none or two depending on
 * which wording the world holds. That is around 4000 entries in a six-type mix, and if it
 * ever needs fixing the ordering to reach for is embedding distance rather than trigram
 * distance, because it is the only one that cannot disagree with the scorer that decides,
 * and the product already keeps those vectors in Qdrant.
 *
 * Read the retention columns and not the weighted cost when comparing orderings at that
 * size, which is the one trap in the measurement: at 1009 slug's weighted cost is the lowest
 * of the three, and the reason is that truncation also dropped the corpus's two
 * identical-name false-merge traps, which every ordering merges when the candidate is in the
 * pool. Losing six true candidates to buy two fewer expensive errors is not a property to
 * bank. The retention columns repeated exactly across two runs; the band classifications
 * moved by one subject, which is issue #279's known jitter and not the pool.
 *
 * **The effective cap is 20 and not 200**, for the same pre-filter reason, which is worth
 * knowing before reading `truncatedPools` as "the pool was complete": one type reaches 21
 * entities at 69 to 121 entries depending on the type mix, and from there the 20 candidates
 * that reach the scorer for a subject sharing no token with any of them are the
 * alphabetically first 20. */
export async function candidateEntitiesForMatching(
	db: Db,
	universeId: string,
	type: EntityType,
	limit = 200
): Promise<MatchCandidatePool> {
	const rows = await db
		.select({
			id: entity.id,
			name: entity.name,
			aliases: entity.aliases,
			type: entity.type,
			bodyLead: sql<string>`left(${entity.body}, ${BODY_LEAD_CHARS})`
		})
		.from(entity)
		.where(and(eq(entity.universeId, universeId), eq(entity.type, type)))
		.orderBy(entity.slug)
		.limit(limit + 1);
	return { candidates: rows.slice(0, limit), truncated: rows.length > limit };
}

// ---------------------------------------------------------------------------
// The job's own pending proposals (issue #160): the merge engine's candidate pool for
// document N has to include the `create` proposals documents 1..N-1 of this same job
// already wrote, not only committed canon - otherwise every document that names an
// entity a vault already introduced elsewhere proposes it again, and the second accept
// collides on `entity_universe_slug_key`.
// ---------------------------------------------------------------------------

/** The semantic step's *other* candidate pool (SPEC.md §6.4 step 2, extended by issue
 * #160): still-pending `create`/`draft_entity` proposals of one type from this same import
 * job, read back out of their patch since `proposal` itself carries no `entity.type`
 * column. A row that does not parse as a create patch (should not happen - job-runner.ts
 * always writes one before the next document can see it, but a bad row should never take
 * an otherwise healthy import down) is skipped rather than thrown on.
 *
 * **The type filter is in SQL, and it used to be in TypeScript after the `LIMIT` (issue
 * #627).** That is what made the cap bite far earlier than its number suggests: it capped
 * the job's pending creates of *every* type at 200 and then kept whichever of those
 * happened to be the type asked for. Measured on a job shaped like the OneNote notebook,
 * 440 pending creates over 88 documents, asking for `character` returned 34 of the 74
 * pending characters that existed. So the pool was not a bounded view of the candidates of
 * one type, it was an arbitrary 46% sample of them, and a real first import passes 200
 * creates job-wide around its fortieth document.
 *
 * **Ordered oldest first, and that is a matching decision (issue #627).** Reproducibility
 * needs a total order on something the content settles: `created_at` alone ties, because
 * every candidate of one document's plan is written in one transaction and `now()` is the
 * transaction's, and `proposal.id` is `defaultRandom()`, so ordering by it is stable
 * within one database and different on the next run of the same import. `rank` orders
 * inside a plan and the patch's own slug is the tiebreak across plans, both settled by
 * what the model said rather than by what the heap did.
 *
 * Oldest rather than newest, because within a job a fold target is always older than the
 * sighting that folds into it, and the proposals that collect repeat sightings are the
 * ones a notebook introduces early and keeps naming (the party, the city the campaign sits
 * in). Oldest-first keeps those and gives the pool one composition for the whole job, so a
 * fold decision does not depend on which document asked. Newest-first would evict an
 * anchor halfway through and turn one entity into a second create and then a third. */
export async function pendingEntityProposalsForJob(
	db: Db,
	importJobId: string,
	type: EntityType,
	limit = 200
): Promise<MatchCandidatePool> {
	const rows = await db
		.select({ id: proposal.id, patch: proposal.patch })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposalPlan.id, proposal.planId))
		.where(
			and(
				eq(proposalPlan.importJobId, importJobId),
				eq(proposal.outcome, 'pending'),
				inArray(proposal.kind, ['create', 'draft_entity']),
				sql`${proposal.patch}->>'type' = ${type}`
			)
		)
		.orderBy(proposal.createdAt, proposal.rank, sql`${proposal.patch}->>'slug'`)
		.limit(limit + 1);

	const candidates: MatchCandidateRow[] = [];
	for (const row of rows.slice(0, limit)) {
		try {
			const patch = readEntityCreatePatch(row.patch);
			candidates.push({
				id: row.id,
				name: patch.name,
				aliases: patch.aliases,
				type: patch.type,
				// issue #310: the patch's own body, capped here to the same budget the
				// committed-canon pool caps in SQL, so a pending create and a real entity give
				// the matcher the same shape of context. Written by this same job minutes ago,
				// so it is the proposed summary rather than prose a GM has edited.
				bodyLead: patch.body.slice(0, BODY_LEAD_CHARS)
			});
		} catch {
			// patch: {} before recordProposalDiff ran, or a genuinely malformed row - either
			// way, not a candidate, and not a reason to fail the import over.
		}
	}
	return { candidates, truncated: rows.length > limit };
}

// ---------------------------------------------------------------------------
// The identity guard (issue #479). `entity_universe_slug_key` is UNIQUE on
// (universe_id, slug), universe-wide and *not* per type, so a `create` naming a slug
// the universe already carries is not a proposal a GM can accept: it either fails that
// constraint or, once the name is reused with a free slug, leaves them two entries with
// one name. The two pools above cannot see that, because both filter to one entity
// type: #479's Cairnmouth was proposed as a `place` against a seeded `place` and still
// missed, and a cross-type collision is invisible to them by construction.
// ---------------------------------------------------------------------------

export interface EntityIdentityRow {
	id: string;
	name: string;
	slug: string;
	type: EntityType;
}

/** Every entity in this universe whose slug or case-folded name is one the caller is
 * about to propose. Type-blind on purpose (see the block comment above): the constraint
 * this defends is universe-wide, so narrowing by type here would reintroduce exactly the
 * hole it exists to close.
 *
 * Names and slugs both, because the two can disagree in either direction: a hand-edited
 * slug no longer matches `slugify(name)`, and two different names ("Saint Merrow's" and
 * "Saint Merrows") slugify the same. Aliases are deliberately **not** matched. #479's
 * third defect is a create whose aliases were another entity's name, so treating an
 * alias as identity would turn that same bad extraction into a false merge, which
 * SPEC.md §6.4 calls the expensive error. */
export async function entitiesByIdentity(
	db: Db,
	universeId: string,
	slugs: string[],
	names: string[]
): Promise<EntityIdentityRow[]> {
	const wantedSlugs = [...new Set(slugs.filter((s) => s.length > 0))];
	const wantedNames = [
		...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0))
	];
	if (wantedSlugs.length === 0 && wantedNames.length === 0) return [];
	const clauses = [];
	if (wantedSlugs.length > 0) clauses.push(inArray(entity.slug, wantedSlugs));
	if (wantedNames.length > 0) clauses.push(inArray(sql`lower(${entity.name})`, wantedNames));
	return db
		.select({ id: entity.id, name: entity.name, slug: entity.slug, type: entity.type })
		.from(entity)
		.where(and(eq(entity.universeId, universeId), or(...clauses)));
}

/** The same question as `entitiesByIdentity`, asked of this job's own still-pending
 * `create`/`draft_entity` proposals (issues #479, #627): which of them already claim a slug
 * or a case-folded name the caller is about to propose.
 *
 * **This replaces reading a capped page of the job's pending creates and filtering it in
 * TypeScript.** The identity guard is exact equality on a slug or a folded name, so a pool
 * cut short by a `LIMIT` is pure loss with no ordering that can rescue it: the one row that
 * mattered is either in the page or the collision goes unseen, and what it costs is #479's
 * defect back again, a second `create` on a slug `entity_universe_slug_key` will refuse.
 * Asked as a lookup instead, the result is bounded by how many names one document proposes
 * rather than by a cap, so it is complete, and it puts both halves of the identity pool on
 * the same footing: the committed half was always keyed this way.
 *
 * The slug returned is the patch's own, not `slugify(name)` recomputed: the accept will
 * write that string, so it is the one the constraint will see.
 *
 * Type-blind, and unordered on purpose: a complete answer to an equality test has nothing
 * to order. Aliases are not matched here either, for the reason `entitiesByIdentity`
 * gives. */
export async function pendingEntityProposalsByIdentity(
	db: Db,
	importJobId: string,
	slugs: string[],
	names: string[]
): Promise<EntityIdentityRow[]> {
	const wantedSlugs = [...new Set(slugs.filter((s) => s.length > 0))];
	const wantedNames = [
		...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0))
	];
	if (wantedSlugs.length === 0 && wantedNames.length === 0) return [];
	const identityClauses = [];
	if (wantedSlugs.length > 0)
		identityClauses.push(inArray(sql`${proposal.patch}->>'slug'`, wantedSlugs));
	if (wantedNames.length > 0)
		identityClauses.push(inArray(sql`lower(${proposal.patch}->>'name')`, wantedNames));
	const rows = await db
		.select({
			id: proposal.id,
			name: sql<string>`${proposal.patch}->>'name'`,
			slug: sql<string>`${proposal.patch}->>'slug'`,
			type: sql<EntityType>`${proposal.patch}->>'type'`
		})
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposalPlan.id, proposal.planId))
		.where(
			and(
				eq(proposalPlan.importJobId, importJobId),
				eq(proposal.outcome, 'pending'),
				inArray(proposal.kind, ['create', 'draft_entity']),
				or(...identityClauses)
			)
		);
	// A patch with no name is a row `recordProposalDiff` has not reached yet, which is not
	// an identity anybody can collide with.
	return rows.filter((row) => row.name !== null && row.slug !== null);
}

export interface EntityUpdateTargetRow {
	id: string;
	name: string;
	aliases: string[];
	body: string;
}

/** What an `update` proposal would be overwriting, for each of `ids` (issue #479).
 *
 * The full `entity.body`, not `MatchCandidateRow.bodyLead`: that one caps at 400
 * characters because it feeds an embedding over a 200-row pool, and this guard has to
 * reason about what an accept would *delete*, so a body whose `:::secret` block sits past
 * that cap must not read as having none. Name and aliases come along because the same
 * decision needs them: once a refused body write leaves a patch carrying nothing the
 * entity does not already say, there is no proposal left worth a GM's attention.
 *
 * Keyed by id. A caller with no row for an id reads it as "nothing known", which is the
 * conservative direction: no current body means nothing to lose. */
export async function entityUpdateTargetsByIds(
	db: Db,
	ids: string[]
): Promise<Map<string, EntityUpdateTargetRow>> {
	const wanted = [...new Set(ids)];
	if (wanted.length === 0) return new Map();
	const rows = await db
		.select({ id: entity.id, name: entity.name, aliases: entity.aliases, body: entity.body })
		.from(entity)
		.where(inArray(entity.id, wanted));
	return new Map(rows.map((row) => [row.id, row]));
}

export interface RelationEndpointTypes {
	/** Keyed by `entity.id`. */
	entities: Map<string, EntityType>;
	/** Keyed by `proposal.id`, carrying the type the create's own patch declares - which
	 * is what that proposal will write if it is accepted. */
	proposals: Map<string, EntityType>;
}

/** The entity type sitting at each end of a relation the import is about to propose
 * (issue #628).
 *
 * This exists because the type a *document* declared for a name and the type of the thing
 * the endpoint actually resolved onto are two different facts, and #191's allowed-type
 * check is about the second one. `job-runner.ts` used to size a relation type from the
 * first: a document calling "Martello di Korr" a faction sized `esercito della` as
 * faction -> faction, while the endpoint had resolved onto an earlier document's `create`
 * proposal declaring it a place, so the accept met place -> faction and #191 refused it.
 * Both ends are readable before the type is ever sized, so it is sized from them.
 *
 * Two id spaces because a relation endpoint is one of two things (`RelationEndpoint` in
 * job-runner.ts): an entity that already exists, or one of this job's own still-pending
 * `create` proposals. A third kind, a create in the document being materialised right
 * now, has no id yet and needs no query - its declared type is the payload in hand.
 *
 * An id with no row is absent rather than defaulted: the caller falls back to the
 * document's own declaration, which is the only other thing it knows. */
export async function relationEndpointTypesByIds(
	db: Db,
	entityIds: string[],
	proposalIds: string[]
): Promise<RelationEndpointTypes> {
	const wantedEntities = [...new Set(entityIds)];
	const wantedProposals = [...new Set(proposalIds)];
	const [entityRows, proposalRows] = await Promise.all([
		wantedEntities.length === 0
			? []
			: db
					.select({ id: entity.id, type: entity.type })
					.from(entity)
					.where(inArray(entity.id, wantedEntities)),
		wantedProposals.length === 0
			? []
			: db
					.select({ id: proposal.id, type: sql<string>`${proposal.patch} ->> 'type'` })
					.from(proposal)
					.where(inArray(proposal.id, wantedProposals))
	]);
	return {
		entities: new Map(entityRows.map((row) => [row.id, row.type])),
		proposals: new Map(
			proposalRows
				.filter((row): row is { id: string; type: string } => row.type !== null)
				.map((row) => [row.id, row.type as EntityType])
		)
	};
}

export interface FoldEntitySightingInput {
	proposalId: string;
	/** This sighting's own name plus its declared aliases - unioned into the pending
	 * proposal's alias list (minus whatever already equals its name) so a later document
	 * that calls the entity something slightly different stays findable by both. The
	 * first sighting's name and body stay authoritative: the document a vault names an
	 * entity after is what should author its prose, not whichever document happens to
	 * mention it second. */
	names: string[];
	/** issue #178: the folding document's own identity, threaded onto the surviving
	 * proposal's evidence (`foldedSources`) so `acceptImportProposal` can give it an
	 * `entity_source_ref` row of its own once the proposal lands - not just the first
	 * document's, which is all `evidence.sourceRef` itself ever points to. */
	documentId: string;
	sourceRef: { documentId: string; path: string };
	contentHash: string;
}

/** One folded-in document's own provenance, as recorded on a `create`/`draft_entity`
 * proposal's `evidence.foldedSources` (issue #178). Read defensively, like every other
 * field on `proposal.evidence` - the column carries no schema, only this file's own
 * writers (`foldEntitySightingIntoPendingProposal` below) ever produce one. */
interface FoldedSourceRef {
	documentId: string;
	sourceRef: { documentId: string; path: string };
	contentHash: string;
}

function readFoldedSources(evidence: unknown): FoldedSourceRef[] {
	if (typeof evidence !== 'object' || evidence === null) return [];
	const raw = (evidence as Record<string, unknown>).foldedSources;
	if (!Array.isArray(raw)) return [];
	const result: FoldedSourceRef[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue;
		const record = entry as Record<string, unknown>;
		const sourceRef = record.sourceRef;
		if (typeof sourceRef !== 'object' || sourceRef === null) continue;
		const sourceRefRecord = sourceRef as Record<string, unknown>;
		if (
			typeof record.documentId === 'string' &&
			typeof sourceRefRecord.documentId === 'string' &&
			typeof sourceRefRecord.path === 'string' &&
			typeof record.contentHash === 'string'
		) {
			result.push({
				documentId: record.documentId,
				sourceRef: { documentId: sourceRefRecord.documentId, path: sourceRefRecord.path },
				contentHash: record.contentHash
			});
		}
	}
	return result;
}

/** issue #160: folds a repeat sighting of an entity this job already proposed as a
 * `create` into that same pending proposal, instead of writing a second, colliding one.
 * A no-op if the proposal moved on since the caller read it as a match candidate (an
 * accept or reject racing this same import job) - that is a different, already-handled
 * outcome, not a failure of the fold itself.
 *
 * issue #178: also records the folding document's own sourceRef/contentHash onto the
 * proposal's evidence (`foldedSources`), keyed by `documentId` so a document that folds
 * more than once (a crash-resumed run reprocessing it) does not pile up duplicate
 * entries. Without this, `acceptImportProposal` only ever learns about the *first*
 * document's path - `evidence.sourceRef` never moves off it - so every other document
 * that folded into this same proposal got no `entity_source_ref` row at all and was
 * re-processed on every later import. */
export async function foldEntitySightingIntoPendingProposal(
	db: Db,
	input: FoldEntitySightingInput
): Promise<void> {
	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing || existing.outcome !== 'pending') return;
		if (existing.kind !== 'create' && existing.kind !== 'draft_entity') return;

		const patch = readEntityCreatePatch(existing.patch);
		const currentAliases = new Set(patch.aliases);
		const additions = input.names.filter(
			(name) => name !== patch.name && !currentAliases.has(name)
		);

		const foldedSources = readFoldedSources(existing.evidence);
		const alreadyRecorded = foldedSources.some((source) => source.documentId === input.documentId);
		if (additions.length === 0 && alreadyRecorded) return;

		const evidenceBase =
			typeof existing.evidence === 'object' && existing.evidence !== null
				? (existing.evidence as Record<string, unknown>)
				: {};

		await tx
			.update(proposal)
			.set({
				patch:
					additions.length > 0
						? { ...patch, aliases: [...patch.aliases, ...additions] }
						: existing.patch,
				evidence: alreadyRecorded
					? existing.evidence
					: {
							...evidenceBase,
							foldedSources: [
								...foldedSources,
								{
									documentId: input.documentId,
									sourceRef: input.sourceRef,
									contentHash: input.contentHash
								}
							]
						}
			})
			.where(eq(proposal.id, existing.id));
	});
}

export interface RecordEntitySourceRefInput {
	entityId: string;
	sourceSystem: string;
	externalId: string | null;
	sourceUrl: string | null;
	contentHash: string;
	lastImportJobId: string | null;
}

/** Writes (or refreshes) the row that makes a later re-import of the same document a
 * no-op (SPEC.md §6.4). `onConflictDoUpdate` on `(sourceSystem, externalId)` only
 * actually de-duplicates when `externalId` is non-null - Postgres treats NULLs as
 * distinct in a unique index, which matches SPEC.md §6.4's own framing: a source with no
 * stable id ("Obsidian file paths change, a PDF has none") never had an exact-match path
 * to begin with, semantic matching is what carries it instead. */
export async function recordEntitySourceRef(
	db: Db,
	input: RecordEntitySourceRefInput
): Promise<EntitySourceRefRow> {
	if (input.externalId === null) {
		const [row] = await db
			.insert(entitySourceRef)
			.values({ ...input, lastSeenAt: new Date() })
			.returning();
		if (!row) throw new Error('recordEntitySourceRef: insert returned no row');
		return row;
	}

	const [row] = await db
		.insert(entitySourceRef)
		.values({ ...input, lastSeenAt: new Date() })
		.onConflictDoUpdate({
			target: [entitySourceRef.sourceSystem, entitySourceRef.externalId],
			set: {
				entityId: input.entityId,
				sourceUrl: input.sourceUrl,
				contentHash: input.contentHash,
				missingInSource: false,
				lastImportJobId: input.lastImportJobId,
				lastSeenAt: new Date()
			}
		})
		.returning();
	if (!row) throw new Error('recordEntitySourceRef: upsert returned no row');
	return row;
}

// ---------------------------------------------------------------------------
// Missing-in-source bookkeeping (issue #163, SPEC.md §6.4's "entity disappeared from
// the source" row): never delete, mark `missing_in_source` and let the GM decide. Runs
// once per successfully *finished* import, never for a partial one (`stopped_at_ceiling`,
// `cancelled`, `failed`) - job-runner.ts's caller is the only one that decides that, this
// function trusts the status it is handed and does the set arithmetic.
// ---------------------------------------------------------------------------

export interface SyncMissingEntitySourceRefsInput {
	universeId: string;
	sourceSystem: string;
	/** Every document `externalId` (source path) this run's export actually carried -
	 * the full current document list, not only the ones freshly reprocessed, so a
	 * document a checkpoint resume already marked `finished` earlier still counts as
	 * present. */
	touchedExternalIds: string[];
	importJobId: string;
}

export interface SyncMissingEntitySourceRefsResult {
	markedMissing: EntitySourceRefRow[];
	unmarked: EntitySourceRefRow[];
}

/** A row with no `externalId` never had an exact-match path to begin with (semantic
 * matching carried it instead - see `recordEntitySourceRef`'s own comment), so there is
 * no set of "this run's paths" to compare it against; only rows with a real external id
 * ever move in or out of `missing_in_source` here. Two symmetric updates, not one: a
 * row absent from `touchedExternalIds` is newly missing, and a row present in it that
 * was previously missing has come back - SPEC.md §6.4's row implies both halves, "let
 * the GM decide" only makes sense if a returning entity un-decides itself. */
export async function syncMissingEntitySourceRefs(
	db: Db,
	input: SyncMissingEntitySourceRefsInput
): Promise<SyncMissingEntitySourceRefsResult> {
	return db.transaction(async (tx) => {
		const universeEntityIds = () =>
			tx.select({ id: entity.id }).from(entity).where(eq(entity.universeId, input.universeId));

		const markedMissing = await tx
			.update(entitySourceRef)
			.set({ missingInSource: true, lastImportJobId: input.importJobId })
			.where(
				and(
					eq(entitySourceRef.sourceSystem, input.sourceSystem),
					isNotNull(entitySourceRef.externalId),
					eq(entitySourceRef.missingInSource, false),
					inArray(entitySourceRef.entityId, universeEntityIds()),
					notInArray(entitySourceRef.externalId, input.touchedExternalIds)
				)
			)
			.returning();

		const unmarked = await tx
			.update(entitySourceRef)
			.set({ missingInSource: false })
			.where(
				and(
					eq(entitySourceRef.sourceSystem, input.sourceSystem),
					isNotNull(entitySourceRef.externalId),
					eq(entitySourceRef.missingInSource, true),
					inArray(entitySourceRef.entityId, universeEntityIds()),
					inArray(entitySourceRef.externalId, input.touchedExternalIds)
				)
			)
			.returning();

		return { markedMissing, unmarked };
	});
}

export interface MissingEntitySourceRefRow {
	entitySourceRefId: string;
	entityId: string;
	name: string;
	slug: string;
	type: EntityType;
	externalId: string | null;
	lastSeenAt: Date;
}

/** The review screen's read side (issue #163): every entity this specific job marked
 * missing, for the "X entities missing from this import" surface. Scoped to
 * `lastImportJobId` rather than "everything currently missing in this universe" - the
 * review route is about what *this* run found, and an entity a much earlier run already
 * marked (and this run left alone because it still was not touched) keeps that earlier
 * job's id and so is correctly excluded here. */
export async function missingEntitySourceRefsForJob(
	db: Db,
	importJobId: string
): Promise<MissingEntitySourceRefRow[]> {
	const rows = await db
		.select({
			entitySourceRefId: entitySourceRef.id,
			entityId: entity.id,
			name: entity.name,
			slug: entity.slug,
			type: entity.type,
			externalId: entitySourceRef.externalId,
			lastSeenAt: entitySourceRef.lastSeenAt
		})
		.from(entitySourceRef)
		.innerJoin(entity, eq(entity.id, entitySourceRef.entityId))
		.where(
			and(
				eq(entitySourceRef.lastImportJobId, importJobId),
				eq(entitySourceRef.missingInSource, true)
			)
		)
		.orderBy(entity.name);
	return rows;
}

// ---------------------------------------------------------------------------
// Accept + source-ref bookkeeping together (issue #36): the exclusive proposal writer
// (proposals.ts's acceptProposal) has no reason to know about entity_source_ref, so
// this wraps the two into one call for a review flow that wants both to land together.
// ---------------------------------------------------------------------------

export interface AcceptImportProposalInput extends AcceptProposalInput {
	sourceSystem: string;
	externalId: string | null;
	sourceUrl: string | null;
	contentHash: string;
	importJobId: string;
}

export async function acceptImportProposal(
	db: Db,
	input: AcceptImportProposalInput
): Promise<ProposalRow> {
	const accepted = await acceptProposal(db, {
		proposalId: input.proposalId,
		decidedBy: input.decidedBy ?? null
	});
	if (!accepted.appliedRevisionId) return accepted;

	const [rev] = await db
		.select({ entityId: revision.entityId })
		.from(revision)
		.where(eq(revision.id, accepted.appliedRevisionId))
		.limit(1);
	if (!rev) return accepted;

	await recordEntitySourceRef(db, {
		entityId: rev.entityId,
		sourceSystem: input.sourceSystem,
		externalId: input.externalId,
		sourceUrl: input.sourceUrl,
		contentHash: input.contentHash,
		lastImportJobId: input.importJobId
	});

	// issue #178: a document that folded its sighting into another document's still-
	// pending create proposal (foldEntitySightingIntoPendingProposal, issue #160) never
	// became `evidence.sourceRef` on the accepted proposal - that stays the first
	// document's, on purpose (its prose is what became the entity's body and patch). Every
	// folded document still named the same real entity, though, so each one recorded in
	// `evidence.foldedSources` gets its own `entity_source_ref` row here, against the same
	// entity `rev.entityId` just resolved to, so it is skipped on the next import too.
	await Promise.all(
		readFoldedSources(accepted.evidence).map((source) =>
			recordEntitySourceRef(db, {
				entityId: rev.entityId,
				sourceSystem: input.sourceSystem,
				externalId: source.sourceRef.path,
				sourceUrl: null,
				contentHash: source.contentHash,
				lastImportJobId: input.importJobId
			})
		)
	);

	return accepted;
}

// ---------------------------------------------------------------------------
// Relation-type vocabulary proposals (decision K1, issue #190): the three
// non-'existing' outcomes of @canonry/copilot's resolveRelationType (issue #189) -
// reuse-proposed, widen-proposed, new-proposed - never write a relation_type row or a
// relation row by themselves. Each becomes exactly one proposal per distinct
// vocabulary question per job, not one per relation - "twelve relations that all
// wanted 'works for' are one question, not twelve" - carrying every relation waiting
// on the answer in its own patch. Accepting is the only path an import ever creates
// or widens a relation_type row through (guardrail 1: a relation type is content, not
// configuration); it never writes a relation row directly either, it unblocks the
// waiting relation(s) into their own pending 'relation' proposals, so each still gets
// its own accept and #191's allowed_from/allowed_to check on that accept path rather
// than a side door around it.
//
// This module stays free of @canonry/copilot (db is the lower layer) - job-runner.ts
// translates a RelationTypeResolution into the plain RelationTypeVocabResolutionInput
// shapes below before ever calling in here.
// ---------------------------------------------------------------------------

export interface RelationTypeWaitingRelation {
	/** The entity this relation starts at. Null when the entity does not exist yet because
	 * the same import is proposing it (issue #613), in which case `fromProposalId` names the
	 * `create` proposal that will. Exactly one of the two is set. */
	fromEntityId: string | null;
	/** Issue #613. Absent on every row written before that issue, which is why the two
	 * fields above and below are read defensively rather than destructured: a vocabulary
	 * proposal is a jsonb patch that can outlive a deploy. */
	fromProposalId?: string | null;
	toEntityId: string | null;
	toProposalId?: string | null;
	rationale: string;
	/** The same shape a plain 'relation' proposal's evidence already carries
	 * ({ documentId, sourceRef, evidenceSpan } - job-runner.ts's own comment on
	 * materializeDocumentProposals) - this relation becomes exactly that proposal,
	 * unchanged, the moment the vocabulary question it is waiting on is accepted. */
	evidence: unknown;
}

export type RelationTypeVocabResolutionInput =
	| {
			kind: 'relation_type_reuse';
			existingTypeId: string;
			proposedLabel: string;
			why: string;
	  }
	| {
			kind: 'relation_type_widen';
			existingTypeId: string;
			addFrom: EntityType | null;
			addTo: EntityType | null;
			why: string;
	  }
	| {
			kind: 'relation_type_new';
			label: string;
			inverseLabel: string;
			cardinality: RelationCardinality;
			fromType: EntityType;
			toType: EntityType;
			why: string;
	  };

export type RelationTypeVocabPatch =
	| {
			kind: 'relation_type_reuse';
			dedupKey: string;
			existingTypeId: string;
			proposedLabel: string;
			relations: RelationTypeWaitingRelation[];
	  }
	| {
			kind: 'relation_type_widen';
			dedupKey: string;
			existingTypeId: string;
			addFrom: EntityType | null;
			addTo: EntityType | null;
			relations: RelationTypeWaitingRelation[];
	  }
	| {
			kind: 'relation_type_new';
			dedupKey: string;
			label: string;
			inverseLabel: string;
			cardinality: RelationCardinality;
			allowedFrom: EntityType[];
			allowedTo: EntityType[];
			relations: RelationTypeWaitingRelation[];
	  };

const RELATION_TYPE_PROPOSAL_KINDS: Record<string, true> = {
	relation_type_reuse: true,
	relation_type_widen: true,
	relation_type_new: true
};

export function isRelationTypeProposalKind(kind: string): kind is RelationTypeVocabPatch['kind'] {
	return RELATION_TYPE_PROPOSAL_KINDS[kind] === true;
}

/** Grouping key for "the same vocabulary question" within one job - case/whitespace
 * normalisation only, never the semantic step (that already happened once, inside
 * resolveRelationType; this only asks "did a later document in this same job just ask
 * the identical question a moment ago"). */
function normalizeLabelKey(label: string): string {
	return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupKeyFor(resolution: RelationTypeVocabResolutionInput): string {
	switch (resolution.kind) {
		case 'relation_type_reuse':
			return `${resolution.existingTypeId}::${normalizeLabelKey(resolution.proposedLabel)}`;
		case 'relation_type_widen':
			return `${resolution.existingTypeId}::${resolution.addFrom ?? '-'}::${resolution.addTo ?? '-'}`;
		case 'relation_type_new':
			return normalizeLabelKey(resolution.label);
	}
}

function initialPatchFor(
	resolution: RelationTypeVocabResolutionInput,
	dedupKey: string,
	relation: RelationTypeWaitingRelation
): RelationTypeVocabPatch {
	switch (resolution.kind) {
		case 'relation_type_reuse':
			return {
				kind: 'relation_type_reuse',
				dedupKey,
				existingTypeId: resolution.existingTypeId,
				proposedLabel: resolution.proposedLabel,
				relations: [relation]
			};
		case 'relation_type_widen':
			return {
				kind: 'relation_type_widen',
				dedupKey,
				existingTypeId: resolution.existingTypeId,
				addFrom: resolution.addFrom,
				addTo: resolution.addTo,
				relations: [relation]
			};
		case 'relation_type_new':
			return {
				kind: 'relation_type_new',
				dedupKey,
				label: resolution.label,
				inverseLabel: resolution.inverseLabel,
				cardinality: resolution.cardinality,
				allowedFrom: [resolution.fromType],
				allowedTo: [resolution.toType],
				relations: [relation]
			};
	}
}

function vocabSummaryFor(resolution: RelationTypeVocabResolutionInput): string {
	switch (resolution.kind) {
		case 'relation_type_reuse':
			return `Import: relation vocabulary - reuse an existing type for "${resolution.proposedLabel}".`;
		case 'relation_type_widen':
			return 'Import: relation vocabulary - widen an existing type.';
		case 'relation_type_new':
			return `Import: relation vocabulary - new type "${resolution.label}".`;
	}
}

export interface PendingRelationTypeProposalMatch {
	id: string;
	patch: RelationTypeVocabPatch;
}

/** Finds this job's own still-pending vocabulary proposal asking the same question
 * (same kind and dedup key), so a later document's sighting folds into it instead of
 * asking again - the "ask once, not per relation" shape (issue #190, D6's shape
 * applied to relation vocabulary). Scoped to importJobId, never across jobs: two
 * different imports asking the same question get their own proposals, since accepting
 * one has no bearing on whether the other job's GM has seen it yet. */
export async function pendingRelationTypeProposalForJob(
	db: Db,
	importJobId: string,
	kind: RelationTypeVocabPatch['kind'],
	dedupKey: string
): Promise<PendingRelationTypeProposalMatch | null> {
	const [row] = await db
		.select({ id: proposal.id, patch: proposal.patch })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(
			and(
				eq(proposalPlan.importJobId, importJobId),
				eq(proposal.kind, kind),
				eq(proposal.outcome, 'pending'),
				sql`${proposal.patch} ->> 'dedupKey' = ${dedupKey}`
			)
		)
		.limit(1);
	return row ? { id: row.id, patch: row.patch as RelationTypeVocabPatch } : null;
}

/** Appends a repeat sighting to an already-pending vocabulary proposal rather than
 * asking a second time. A 'relation_type_new' proposal also grows its own accumulated
 * allowedFrom/allowedTo union as more sightings arrive across documents in the same
 * job - #191's "narrower than the world needs" bug (a type invented from one sighting)
 * fixed at the source: the type this proposal will create on accept is sized to every
 * relation actually waiting on it, never just the first one seen. `newTypePair` is
 * only meaningful (and only ever passed) for a 'relation_type_new' fold.
 *
 * Issue #638: the fold also writes `rank`, which is how many relations are waiting on
 * this question once this sighting is in. `rank` is "ordering inside a plan" everywhere
 * else (`proposal.rank`'s own comment, decision C3's cap), and a vocabulary question is
 * a plan of exactly one candidate, so that job was vacant here and the column was left
 * at 0 for all 130 questions a real notebook asks. This is the number the review queue
 * orders them by, and it has to be written on the fold rather than once at creation
 * because a question's weight is only known when the job ends: on the OneNote notebook
 * `located in` reaches 19 relations across 88 documents, one sighting at a time. */
export async function foldRelationIntoPendingRelationTypeProposal(
	db: Db,
	proposalId: string,
	relation: RelationTypeWaitingRelation,
	newTypePair?: { fromType: EntityType; toType: EntityType }
): Promise<void> {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ patch: proposal.patch })
			.from(proposal)
			.where(eq(proposal.id, proposalId))
			.for('update')
			.limit(1);
		if (!row) {
			throw new Error(
				`foldRelationIntoPendingRelationTypeProposal: proposal "${proposalId}" not found`
			);
		}
		const patch = row.patch as RelationTypeVocabPatch;
		const relations = [...patch.relations, relation];
		const nextPatch: RelationTypeVocabPatch =
			patch.kind === 'relation_type_new' && newTypePair
				? {
						...patch,
						relations,
						allowedFrom: patch.allowedFrom.includes(newTypePair.fromType)
							? patch.allowedFrom
							: [...patch.allowedFrom, newTypePair.fromType],
						allowedTo: patch.allowedTo.includes(newTypePair.toType)
							? patch.allowedTo
							: [...patch.allowedTo, newTypePair.toType]
					}
				: { ...patch, relations };
		await tx
			.update(proposal)
			.set({ patch: nextPatch, rank: relations.length })
			.where(eq(proposal.id, proposalId));
	});
}

export interface ProposeRelationTypeVocabularyInput {
	universeId: string;
	importJobId: string;
	resolution: RelationTypeVocabResolutionInput;
	relation: RelationTypeWaitingRelation;
	/** Threaded straight to recordProposalDiff, same as every entity/relation diff this
	 * job writes (job-runner.ts's own `provider: 'import', modelId: params.playbook.id`) -
	 * a vocabulary proposal's diff is attributed to the same playbook run as everything
	 * else it produced. */
	provider: string;
	modelId: string;
}

export interface ProposeRelationTypeVocabularyResult {
	proposalId: string;
	created: boolean;
}

/** The single entry point job-runner.ts calls for every relation whose
 * resolveRelationType outcome was not 'existing': folds into this job's own
 * still-pending vocabulary proposal for the same question if one exists, otherwise
 * creates it fresh. */
export async function proposeRelationTypeVocabulary(
	db: Db,
	input: ProposeRelationTypeVocabularyInput
): Promise<ProposeRelationTypeVocabularyResult> {
	const dedupKey = dedupKeyFor(input.resolution);
	const existing = await pendingRelationTypeProposalForJob(
		db,
		input.importJobId,
		input.resolution.kind,
		dedupKey
	);
	if (existing) {
		await foldRelationIntoPendingRelationTypeProposal(
			db,
			existing.id,
			input.relation,
			input.resolution.kind === 'relation_type_new'
				? { fromType: input.resolution.fromType, toType: input.resolution.toType }
				: undefined
		);
		return { proposalId: existing.id, created: false };
	}

	const patch = initialPatchFor(input.resolution, dedupKey, input.relation);
	const { proposals } = await createProposalPlan(db, {
		universeId: input.universeId,
		trigger: 'import',
		importJobId: input.importJobId,
		summary: vocabSummaryFor(input.resolution),
		candidateCap: 1,
		estimatedCredits: 0,
		candidates: [
			{
				kind: input.resolution.kind,
				targetEntityId: null,
				relationTypeId:
					input.resolution.kind === 'relation_type_new' ? null : input.resolution.existingTypeId,
				relatedEntityId: null,
				rationale: input.resolution.why,
				evidence: {},
				// Issue #638: one relation is waiting the moment the question exists, and the
				// fold above raises this as more arrive. Never 0, so a question is always
				// ordered by something true rather than by the column's default.
				rank: 1
			}
		]
	});
	const created = proposals[0];
	if (!created) throw new Error('proposeRelationTypeVocabulary: no proposal row returned');
	await recordProposalDiff(db, {
		proposalId: created.id,
		patch,
		provider: input.provider,
		modelId: input.modelId,
		credits: 0
	});
	return { proposalId: created.id, created: true };
}

export interface AcceptRelationTypeProposalInput {
	proposalId: string;
	decidedBy?: string | null;
}

export interface AcceptRelationTypeProposalResult {
	proposal: ProposalRow;
	relationTypeId: string;
	unblockedProposalIds: string[];
}

/** Guardrail 1's boundary for a relation-type vocabulary proposal (issue #190's half of
 * K1): the only place an import's reuse-proposed/widen-proposed/new-proposed
 * resolution reaches canon. One transaction: resolve or write the relation_type row
 * (nothing for reuse; insert, racing safely, for new; a JS-side union of
 * allowed_from/allowed_to for widen, inlined here rather than calling
 * relation-types.ts's own widenRelationType - that function takes a `Db`, and `Db`'s
 * `$client` member is not present on this transaction's own handle, so it cannot be
 * called from inside one), then unblock every relation that was waiting into its own
 * pending 'relation' proposal - never a direct relation write, so each one still gets
 * its own accept and #191's allowed_from/allowed_to check on that accept path. */
export async function acceptRelationTypeProposal(
	db: Db,
	input: AcceptRelationTypeProposalInput
): Promise<AcceptRelationTypeProposalResult> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(input.proposalId);
		if (!isRelationTypeProposalKind(existing.kind)) {
			throw new Error(
				`acceptRelationTypeProposal: proposal "${existing.id}" has kind "${existing.kind}", not a relation-type vocabulary kind`
			);
		}
		if (existing.outcome !== 'pending') {
			throw new ProposalAlreadyDecidedError(input.proposalId, existing.outcome);
		}

		const patch = existing.patch as RelationTypeVocabPatch;
		let relationTypeId: string;

		if (patch.kind === 'relation_type_new') {
			const [created] = await tx
				.insert(relationType)
				.values({
					universeId: existing.universeId,
					label: patch.label,
					inverseLabel: patch.inverseLabel,
					cardinality: patch.cardinality,
					allowedFrom: patch.allowedFrom,
					allowedTo: patch.allowedTo
				})
				.onConflictDoNothing({ target: [relationType.universeId, relationType.label] })
				.returning();
			if (created) {
				relationTypeId = created.id;
			} else {
				// Lost a race against another accept that created the same (universe, label)
				// meanwhile - reuse the row that won rather than erroring, the same fallback
				// the deleted findOrCreateRelationType used to take.
				const [winner] = await tx
					.select()
					.from(relationType)
					.where(
						and(
							eq(relationType.universeId, existing.universeId),
							eq(relationType.label, patch.label)
						)
					)
					.limit(1);
				if (!winner) {
					throw new Error(
						`acceptRelationTypeProposal: no relation_type row for universe "${existing.universeId}" label "${patch.label}" after insert raced`
					);
				}
				relationTypeId = winner.id;
			}
		} else if (patch.kind === 'relation_type_widen') {
			const [current] = await tx
				.select()
				.from(relationType)
				.where(eq(relationType.id, patch.existingTypeId))
				.for('update')
				.limit(1);
			if (!current) {
				throw new Error(
					`acceptRelationTypeProposal: relation_type "${patch.existingTypeId}" not found to widen`
				);
			}
			const allowedFrom =
				patch.addFrom && !current.allowedFrom.includes(patch.addFrom)
					? [...current.allowedFrom, patch.addFrom]
					: current.allowedFrom;
			const allowedTo =
				patch.addTo && !current.allowedTo.includes(patch.addTo)
					? [...current.allowedTo, patch.addTo]
					: current.allowedTo;
			await tx
				.update(relationType)
				.set({ allowedFrom, allowedTo })
				.where(eq(relationType.id, patch.existingTypeId));
			relationTypeId = patch.existingTypeId;
		} else {
			relationTypeId = patch.existingTypeId;
		}

		const unblocked = patch.relations.length
			? await tx
					.insert(proposal)
					.values(
						patch.relations.map((r, index) => ({
							universeId: existing.universeId,
							planId: existing.planId,
							trigger: 'import' as const,
							kind: 'relation' as const,
							targetEntityId: r.fromEntityId,
							relationTypeId,
							relatedEntityId: r.toEntityId,
							// Issue #613: a relation can be waiting on two different things at once -
							// this vocabulary question, and the entries at its ends that the same
							// import is still only proposing. Answering the vocabulary question is
							// not answering the other one, so the unblocked proposal carries the
							// endpoint pointers through and stays unacceptable until those accepts
							// resolve them. Order between the two does not matter, which is the whole
							// reason the endpoint lives on the proposal rather than in a second queue.
							targetEntityProposalId: r.fromProposalId ?? null,
							relatedEntityProposalId: r.toProposalId ?? null,
							patch: {},
							rationale: r.rationale,
							evidence: r.evidence,
							rank: index,
							outcome: 'pending' as const
						}))
					)
					.returning({ id: proposal.id })
			: [];

		// Issue #613: these relations were held while the vocabulary question was open, and
		// by the time it is answered the entries at their ends have very often been accepted
		// already - on the OneNote notebook that was most of them. Nothing else would ever
		// resolve those endpoints, because `resolveRelationEndpoints` fires from inside an
		// accept and these rows did not exist when it ran.
		await reconcileRelationEndpoints(
			tx,
			unblocked.map((row) => row.id)
		);

		const [updated] = await tx
			.update(proposal)
			.set({
				outcome: 'accepted',
				decidedAt: new Date(),
				decidedBy: input.decidedBy ?? null,
				appliedRevisionId: null
			})
			.where(eq(proposal.id, existing.id))
			.returning();
		if (!updated) throw new Error('acceptRelationTypeProposal: update returned no row');

		return {
			proposal: updated,
			relationTypeId,
			unblockedProposalIds: unblocked.map((row) => row.id)
		};
	});
}

/** Dispatches an import proposal's accept by kind - the ripple every consumer of
 * job-runner.ts's relation-vocabulary proposals shares (the review queue at
 * apps/web/src/routes/w/[universe]/import/[job]/review and onboarding's own live feed
 * both accept whatever kind a job happened to produce). A relation-type vocabulary
 * kind routes to acceptRelationTypeProposal above; everything else keeps going through
 * acceptImportProposal exactly as before. */
export async function acceptAnyImportProposal(
	db: Db,
	kind: string,
	input: AcceptImportProposalInput
): Promise<ProposalRow> {
	if (isRelationTypeProposalKind(kind)) {
		const result = await acceptRelationTypeProposal(db, {
			proposalId: input.proposalId,
			decidedBy: input.decidedBy ?? null
		});
		return result.proposal;
	}
	return acceptImportProposal(db, input);
}
