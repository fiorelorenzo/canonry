// SPEC.md §4.6, §6.4, §6.7, issues #26, #27, #29, #30, #36. The database side of the
// import job lifecycle: the queue and concurrency admission, checkpoint persistence,
// exactly-once settlement, per-user quota reads, and the entity_source_ref bookkeeping
// that makes a second import of the same export a no-op. Proposal content itself still
// goes exclusively through proposals.ts's createProposalPlan/recordProposalDiff/
// acceptProposal - "nothing else in the codebase may write canon from a proposal" holds
// here too, this file only adds the import-specific bookkeeping (entity_source_ref)
// around that boundary.
import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType, ImportJobStatus, RelationCardinality } from '../schema/enums.js';
import { relationType } from '../schema/relation.js';
import { revision } from '../schema/revision.js';
import { entitySourceRef, importJob } from '../schema/source.js';
import { userBilling } from '../schema/billing.js';
import { ensureBilling } from './billing.js';
import { acceptProposal, type AcceptProposalInput, type ProposalRow } from './proposals.js';

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
}

/** The semantic step's candidate pool (SPEC.md §6.4 step 2): existing entities in the
 * same universe and of the same type as the proposed one, narrowed no further here -
 * matching.ts's own cheap pre-filter (`preFilterCandidates`) does the rest before any
 * embedding call. */
export async function candidateEntitiesForMatching(
	db: Db,
	universeId: string,
	type: EntityType,
	limit = 200
): Promise<MatchCandidateRow[]> {
	return db
		.select({ id: entity.id, name: entity.name, aliases: entity.aliases })
		.from(entity)
		.where(and(eq(entity.universeId, universeId), eq(entity.type, type)))
		.limit(limit);
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
// Relation types (issue #36/#37's relation half): a proposed relation names a label,
// inverse label and cardinality (driver.ts's `RelationProposalPayload`), never a
// `relation_type` id, because the model has no way to know one. This resolves that
// name into a real catalogue row, creating it once per (universe, label).
// ---------------------------------------------------------------------------

export interface FindOrCreateRelationTypeInput {
	universeId: string;
	label: string;
	inverseLabel: string;
	cardinality: RelationCardinality;
	allowedFrom: EntityType;
	allowedTo: EntityType;
}

export async function findOrCreateRelationType(
	db: Db,
	input: FindOrCreateRelationTypeInput
): Promise<typeof relationType.$inferSelect> {
	const [inserted] = await db
		.insert(relationType)
		.values({
			universeId: input.universeId,
			label: input.label,
			inverseLabel: input.inverseLabel,
			cardinality: input.cardinality,
			allowedFrom: [input.allowedFrom],
			allowedTo: [input.allowedTo]
		})
		.onConflictDoNothing({ target: [relationType.universeId, relationType.label] })
		.returning();
	if (inserted) return inserted;

	const [existing] = await db
		.select()
		.from(relationType)
		.where(and(eq(relationType.universeId, input.universeId), eq(relationType.label, input.label)))
		.limit(1);
	if (!existing) {
		throw new Error(
			`findOrCreateRelationType: no row for universe "${input.universeId}" label "${input.label}" after insert raced`
		);
	}
	return existing;
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
	return accepted;
}
