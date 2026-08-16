// SPEC.md §4.6, §6.4, §6.7, issues #26, #27, #29, #30, #36. The database side of the
// import job lifecycle: the queue and concurrency admission, checkpoint persistence,
// exactly-once settlement, per-user quota reads, and the entity_source_ref bookkeeping
// that makes a second import of the same export a no-op. Proposal content itself still
// goes exclusively through proposals.ts's createProposalPlan/recordProposalDiff/
// acceptProposal - "nothing else in the codebase may write canon from a proposal" holds
// here too, this file only adds the import-specific bookkeeping (entity_source_ref)
// around that boundary.
import { and, count, eq, gte, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
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
	readEntityCreatePatch,
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

// ---------------------------------------------------------------------------
// The job's own pending proposals (issue #160): the merge engine's candidate pool for
// document N has to include the `create` proposals documents 1..N-1 of this same job
// already wrote, not only committed canon - otherwise every document that names an
// entity a vault already introduced elsewhere proposes it again, and the second accept
// collides on `entity_universe_slug_key`.
// ---------------------------------------------------------------------------

/** The semantic step's *other* candidate pool (SPEC.md §6.4 step 2, extended by issue
 * #160): still-pending `create`/`draft_entity` proposals from this same import job, read
 * back out of their patch since `proposal` itself carries no `entity.type` column. A row
 * that does not parse as a create patch (should not happen - job-runner.ts always writes
 * one before the next document can see it, but a bad row should never take an otherwise
 * healthy import down) is skipped rather than thrown on. */
export async function pendingEntityProposalsForJob(
	db: Db,
	importJobId: string,
	type: EntityType,
	limit = 200
): Promise<MatchCandidateRow[]> {
	const rows = await db
		.select({ id: proposal.id, patch: proposal.patch })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposalPlan.id, proposal.planId))
		.where(
			and(
				eq(proposalPlan.importJobId, importJobId),
				eq(proposal.outcome, 'pending'),
				inArray(proposal.kind, ['create', 'draft_entity'])
			)
		)
		.limit(limit);

	const candidates: MatchCandidateRow[] = [];
	for (const row of rows) {
		try {
			const patch = readEntityCreatePatch(row.patch);
			if (patch.type === type)
				candidates.push({ id: row.id, name: patch.name, aliases: patch.aliases });
		} catch {
			// patch: {} before recordProposalDiff ran, or a genuinely malformed row - either
			// way, not a candidate, and not a reason to fail the import over.
		}
	}
	return candidates;
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
