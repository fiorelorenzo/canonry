/**
 * The composition root import's other pieces predicted (driver.ts's own comment: "the
 * composition root that wires a real import job together... is the one place that needs
 * both @canonry/db and @canonry/import in scope"). `ImportJobRunner` is that place for
 * issues #26, #27, #30 and #36: it drives an `ImportDriver` against real Postgres,
 * turning its event stream into `import_job` lifecycle transitions, checkpoints, real
 * proposals and `entity_source_ref` bookkeeping.
 *
 * `GatewayDriver`, `tools.ts`, `driver.ts`, `sources.ts`, `images.ts` and `playbook.ts`
 * stay exactly as DB-agnostic and independently testable as before - this file is
 * additive, the one place in the package that imports `@canonry/db`.
 *
 * Five responsibilities, one per acceptance criterion of this wave:
 *
 * - **Admission** (issue #30): `estimateImportJob` and `admitAndCreateImportJob` check
 *   the queue's global concurrency limit and the per-user quota (jobs, documents,
 *   currency) before a job ever touches the driver.
 * - **Lifecycle and timeout** (issue #26): `run` owns a wall-clock timeout independent of
 *   whatever HTTP request or browser tab kicked it off, calls `cancel` itself when it
 *   fires, and settles the job exactly once through `settleImportJob`.
 * - **Checkpoint and resume** (issue #27): every document that finishes (however it
 *   finishes) is recorded in `import_job.checkpoint`; `run` called again on the same job
 *   id skips whatever the checkpoint already marks finished.
 * - **Idempotency** (issue #36): before a document is even handed to the driver, its
 *   content hash is checked against `entity_source_ref` - an unchanged document costs
 *   nothing and produces nothing, which is what makes a second import of the same export
 *   a no-op rather than a duplicate.
 * - **Matching and proposal persistence** (issues #36, #37, §6.1's merge-engine line):
 *   every entity a document proposes is resolved through `resolveMatch` before it
 *   becomes a `proposal` row - exact source ref first, semantic similarity after, never
 *   a silent guess in the in-between band.
 *
 * One deliberate scope boundary, stated rather than hidden: a relation whose endpoint is
 * a brand-new (not yet accepted) entity cannot be written as a `proposal` row under the
 * current schema (`proposal.kind = 'relation'` requires two real, already-existing
 * entity ids). Such relations are dropped for this run rather than invented a workaround
 * for - the entities they would connect still get proposed, and the relation becomes
 * proposable once one side is accepted and a later import (or a manual link) supplies it.
 */
import { createHash } from 'node:crypto';
import {
	acceptImportProposal as dbAcceptImportProposal,
	admitImportJob,
	candidateEntitiesForMatching,
	checkImportQuota,
	createImportJob,
	createProposalPlan,
	findEntityBySourceRef,
	findOrCreateRelationType,
	getBalance,
	getImportJob,
	importQuotaForUser,
	importUsageForUser,
	queuePositionFor,
	recordProposalDiff,
	settleImportJob,
	spendCredits,
	updateImportJobCheckpoint,
	type AcceptImportProposalInput,
	type CreateImportJobInput,
	type CreateProposalPlanCandidate,
	type Db,
	type ProposalRow
} from '@canonry/db';
import { chargeFor } from '@canonry/ai';
import type {
	DocumentStatus,
	EntityProposalPayload,
	ImportDriver,
	ImportJob,
	JobBudget,
	JobDocument,
	JobEvent,
	RelationProposalPayload
} from './driver.js';
import type { LoadedPlaybook } from './playbook.js';
import type { SourceReader } from './sources.js';
import type { ImageStore } from './images.js';
import { resolveMatch, type MatchThresholds, type SimilarityFn } from './matching.js';

// ---------------------------------------------------------------------------
// Estimate (issue #30: "an estimate before the run covering size, time and cost").
// ---------------------------------------------------------------------------

export interface EstimateImportJobInput {
	documentCount: number;
	/** Historical average, supplied by the caller (e.g. read off recent import_job rows
	 * for the same playbook) - never invented here. */
	avgCreditsPerDocument: number;
	avgSecondsPerDocument: number;
}

export interface ImportEstimate {
	documentCount: number;
	estimatedMinutes: number;
	estimatedCredits: number;
}

export function estimateImportJob(input: EstimateImportJobInput): ImportEstimate {
	const estimatedMinutes = Math.max(
		1,
		Math.ceil((input.documentCount * input.avgSecondsPerDocument) / 60)
	);
	const estimatedCredits = Math.ceil(input.documentCount * input.avgCreditsPerDocument);
	return { documentCount: input.documentCount, estimatedMinutes, estimatedCredits };
}

// ---------------------------------------------------------------------------
// Admission (issue #30: queue, concurrency limit, per-user quota).
// ---------------------------------------------------------------------------

export type ImportQuotaRefusalReason = 'jobs_quota' | 'documents_quota' | 'insufficient_credits';

export class ImportQuotaExceededError extends Error {
	constructor(public readonly reason: ImportQuotaRefusalReason) {
		super(`import job refused at admission: ${reason}`);
		this.name = 'ImportQuotaExceededError';
	}
}

export interface AdmitAndCreateImportJobInput extends CreateImportJobInput {
	estimate: ImportEstimate;
	concurrencyLimit: number;
}

export interface AdmitAndCreateImportJobResult {
	jobId: string;
	admitted: boolean;
	/** 1-based position among still-queued jobs, 0 once admitted (SPEC.md §6.7's "third
	 * in queue"). */
	queuePosition: number;
}

/**
 * The full admission decision: quota (jobs, documents, currency) checked first, since a
 * job that will never be allowed to run should never occupy a queue slot; then the
 * concurrency-limited queue itself. Throws `ImportQuotaExceededError` before creating any
 * row when quota refuses - a refused job leaves no trace to clean up.
 */
export async function admitAndCreateImportJob(
	db: Db,
	input: AdmitAndCreateImportJobInput
): Promise<AdmitAndCreateImportJobResult> {
	if (input.createdBy) {
		const [quota, usage, balance] = await Promise.all([
			importQuotaForUser(db, input.createdBy),
			importUsageForUser(db, input.createdBy, periodStartFloor(input)),
			getBalance(db, input.createdBy)
		]);
		const check = checkImportQuota({
			quota,
			usage,
			availableCredits: balance.totalCredits,
			estimate: input.estimate
		});
		if (!check.allowed) throw new ImportQuotaExceededError(check.reason);
	}

	const job = await createImportJob(db, input);
	const admission = await admitImportJob(db, job.id, input.concurrencyLimit);
	const queuePosition = admission.admitted ? 0 : await queuePositionFor(db, job.id);
	return { jobId: job.id, admitted: admission.admitted, queuePosition };
}

/** A job's quota resets on its `user_billing.period_start` - `importQuotaForUser`
 * already reads that column, but the usage count needs the same boundary as its own
 * argument, so this reads the period start once up front for both calls to share. */
function periodStartFloor(input: { createdBy: string | null }): Date {
	void input;
	// A billing period is at most a month; a 31-day floor is a safe, cheap upper bound
	// that never undercounts usage even if `user_billing.period_start` has not been read
	// yet at the point this function is called (admitAndCreateImportJob reads the real
	// period_start via importQuotaForUser in the same Promise.all, but importUsageForUser
	// needs its own `since` argument before that result is available).
	return new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Slugging entities created from a proposal (issue #36's `patch.slug`).
// ---------------------------------------------------------------------------

function slugify(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.length > 0 ? base : 'entity';
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

interface DocumentBuffer {
	entities: Map<string, EntityProposalPayload>;
	relations: RelationProposalPayload[];
}

interface CheckpointShape {
	documents: Record<string, { status: DocumentStatus }>;
}

function readCheckpoint(value: unknown): CheckpointShape {
	if (typeof value !== 'object' || value === null) return { documents: {} };
	const record = value as Record<string, unknown>;
	const documents = record.documents;
	if (typeof documents !== 'object' || documents === null) return { documents: {} };
	return { documents: documents as Record<string, { status: DocumentStatus }> };
}

async function hashOf(sources: SourceReader, path: string): Promise<string> {
	const { content } = await sources.read(path);
	return createHash('sha256').update(content).digest('hex');
}

export interface RunImportJobParams {
	db: Db;
	driver: ImportDriver;
	dbJobId: string;
	universeId: string;
	/** Also the model's provenance system for `entity_source_ref.source_system` - the
	 * playbook id (SPEC.md §6.2's shipped playbooks) doubles as this identity. */
	sourceSystem: string;
	/** Charged to the user's balance whom the job runs for, or `null` for a system/no-op
	 * run that never spends the user's balance (SPEC.md §15's import charge is per
	 * document, not per job, but there is no document charge with nobody to charge). */
	userId: string | null;
	playbook: LoadedPlaybook;
	documents: JobDocument[];
	sources: SourceReader;
	images: ImageStore;
	budget: JobBudget;
	similarity: SimilarityFn;
	thresholds: MatchThresholds;
	/** issue #26: this job cancels itself once this many milliseconds of wall clock pass,
	 * independent of whatever HTTP request or browser tab started it. */
	timeoutMs: number;
}

export interface DocumentOutcome {
	documentId: string;
	status: DocumentStatus | 'skipped_unchanged';
	entityCount: number;
	relationCount: number;
	proposalsCreated: number;
}

export interface RunImportJobResult {
	jobId: string;
	finalStatus: 'finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed';
	documents: DocumentOutcome[];
	proposalsEmitted: number;
}

export class ImportJobRunner {
	constructor(private readonly deps: { pricingOperation?: string } = {}) {}

	cancel(driver: ImportDriver, jobId: string): void {
		driver.cancel(jobId);
	}

	/** Runs (or resumes) one import job to completion. Safe to call again with the same
	 * `dbJobId` after a crash or a cancel: documents the checkpoint already marks
	 * `finished` are skipped, and a document whose content is unchanged since the last
	 * import of the same source ref is skipped before the driver ever sees it. */
	async run(params: RunImportJobParams): Promise<RunImportJobResult> {
		const { db } = params;
		const jobRow = await getImportJob(db, params.dbJobId);
		const checkpoint = readCheckpoint(jobRow.checkpoint);

		const outcomes: DocumentOutcome[] = [];
		const documentsToRun: JobDocument[] = [];
		for (const doc of params.documents) {
			if (checkpoint.documents[doc.id]?.status === 'finished') continue;

			const contentHash = await hashOf(params.sources, doc.sourcePath);
			const existing = await findEntityBySourceRef(
				db,
				params.universeId,
				params.sourceSystem,
				doc.sourcePath
			);
			if (existing && existing.contentHash === contentHash) {
				outcomes.push({
					documentId: doc.id,
					status: 'skipped_unchanged',
					entityCount: 0,
					relationCount: 0,
					proposalsCreated: 0
				});
				checkpoint.documents[doc.id] = { status: 'finished' };
				continue;
			}
			documentsToRun.push(doc);
		}
		await updateImportJobCheckpoint(db, params.dbJobId, {
			checkpoint,
			spentCreditsDelta: 0,
			inputTokensDelta: 0,
			outputTokensDelta: 0
		});

		if (documentsToRun.length === 0) {
			const settled = await settleImportJob(db, params.dbJobId, {
				status: 'finished',
				outcomeNote:
					outcomes.length > 0
						? `nothing changed: all ${outcomes.length} document(s) matched what was already imported`
						: 'no documents to process',
				proposalsEmitted: 0
			});
			return {
				jobId: params.dbJobId,
				finalStatus: settled.job.status as 'finished',
				documents: outcomes,
				proposalsEmitted: 0
			};
		}

		const documentPrice = await chargeFor(db, 'import.document');
		const job: ImportJob = {
			id: params.dbJobId,
			playbook: params.playbook,
			documents: documentsToRun,
			budget: params.budget,
			sources: params.sources,
			images: params.images
		};

		const timeoutHandle = setTimeout(() => params.driver.cancel(params.dbJobId), params.timeoutMs);
		const buffers = new Map<string, DocumentBuffer>();
		let proposalsEmitted = 0;
		let sawStoppedAtCeiling = false;
		let sawCancelled = false;
		let sawFailed = false;

		try {
			const stream = params.driver.startJob(job);
			for await (const event of stream) {
				await handleEvent(event, {
					params,
					checkpoint,
					buffers,
					documentPriceCredits: documentPrice.credits,
					onDocumentSettled: (outcome) => {
						outcomes.push(outcome);
						proposalsEmitted += outcome.proposalsCreated;
						if (outcome.status === 'stopped_at_ceiling') sawStoppedAtCeiling = true;
						if (outcome.status === 'cancelled') sawCancelled = true;
						if (outcome.status === 'failed') sawFailed = true;
					}
				});
			}
		} finally {
			clearTimeout(timeoutHandle);
		}

		// A job-wide credit ceiling (as opposed to a per-document step ceiling) stops the
		// driver's outer loop *before* the next document's runDocument ever starts, so it
		// never yields an explicit 'stopped_at_ceiling' event for the document that got
		// skipped - the stream just ends. Detecting that silence (some document this run
		// was supposed to process never reached a terminal outcome, and nothing cancelled
		// or failed) is what tells the two apart from a clean finish.
		const settledDocumentIds = new Set(outcomes.map((outcome) => outcome.documentId));
		const everyDocumentSettled = documentsToRun.every((doc) => settledDocumentIds.has(doc.id));
		const finalStatus: RunImportJobResult['finalStatus'] = sawCancelled
			? 'cancelled'
			: sawFailed
				? 'failed'
				: sawStoppedAtCeiling || !everyDocumentSettled
					? 'stopped_at_ceiling'
					: 'finished';
		await settleImportJob(db, params.dbJobId, {
			status: finalStatus,
			outcomeNote: `${outcomes.length} document(s) processed, ${proposalsEmitted} proposal(s) emitted`,
			proposalsEmitted
		});

		return { jobId: params.dbJobId, finalStatus, documents: outcomes, proposalsEmitted };
	}
}

interface HandleEventContext {
	params: RunImportJobParams;
	checkpoint: CheckpointShape;
	buffers: Map<string, DocumentBuffer>;
	documentPriceCredits: number;
	onDocumentSettled: (outcome: DocumentOutcome) => void;
}

const DOCUMENT_TERMINAL_STATUSES: readonly DocumentStatus[] = [
	'finished',
	'stopped_at_ceiling',
	'cancelled',
	'failed'
];

async function handleEvent(event: JobEvent, ctx: HandleEventContext): Promise<void> {
	if (event.type === 'proposal') {
		const buffer = bufferFor(ctx.buffers, event.documentId);
		if (event.proposal.kind === 'entity') {
			buffer.entities.set(event.proposal.payload.localId, event.proposal.payload);
		} else {
			buffer.relations.push(event.proposal.payload);
		}
		return;
	}

	if (event.type === 'usage') {
		await updateImportJobCheckpoint(ctx.params.db, ctx.params.dbJobId, {
			checkpoint: ctx.checkpoint,
			spentCreditsDelta: event.credits,
			inputTokensDelta: event.inputTokens,
			outputTokensDelta: event.outputTokens
		});
		return;
	}

	if (event.type !== 'progress' || !DOCUMENT_TERMINAL_STATUSES.includes(event.status)) return;

	let proposalsCreated = 0;
	const buffer = ctx.buffers.get(event.documentId);
	if (buffer && (event.status === 'finished' || event.status === 'stopped_at_ceiling')) {
		proposalsCreated = await materializeDocumentProposals(ctx.params, event.documentId, buffer);
		if (proposalsCreated > 0 && ctx.params.userId) {
			await spendCredits(ctx.params.db, {
				userId: ctx.params.userId,
				universeId: ctx.params.universeId,
				operation: 'import.document',
				credits: ctx.documentPriceCredits,
				idempotencyKey: `import-document:${ctx.params.dbJobId}:${event.documentId}`
			});
		}
	}

	ctx.checkpoint.documents[event.documentId] = { status: event.status };
	await updateImportJobCheckpoint(ctx.params.db, ctx.params.dbJobId, {
		checkpoint: ctx.checkpoint,
		spentCreditsDelta: 0,
		inputTokensDelta: 0,
		outputTokensDelta: 0
	});

	ctx.onDocumentSettled({
		documentId: event.documentId,
		status: event.status,
		entityCount: event.entityCount,
		relationCount: event.relationCount,
		proposalsCreated
	});
}

function bufferFor(buffers: Map<string, DocumentBuffer>, documentId: string): DocumentBuffer {
	const existing = buffers.get(documentId);
	if (existing) return existing;
	const created: DocumentBuffer = { entities: new Map(), relations: [] };
	buffers.set(documentId, created);
	return created;
}

interface ResolvedEntityCandidate {
	localId: string;
	candidate: CreateProposalPlanCandidate;
	patch: unknown;
}

/**
 * SPEC.md §6.1's "match against what already exists, merge, resolve conflicts - a
 * deterministic engine, this is where damage would happen, so no model decides it." Runs
 * `resolveMatch` (matching.ts) for every entity this document proposed, turns the
 * decision into a real `proposal` row (never a silent write - guardrail 1's only
 * exception is a genuinely unchanged field, handled upstream by the content-hash
 * short-circuit before this function is ever called), then does the same for relations
 * whose endpoints both resolved to real, already-existing entities.
 */
async function materializeDocumentProposals(
	params: RunImportJobParams,
	documentId: string,
	buffer: DocumentBuffer
): Promise<number> {
	const { db } = params;
	const localIdToEntityId = new Map<string, string>();
	const localIdToType = new Map<string, EntityProposalPayload['type']>();
	const resolved: ResolvedEntityCandidate[] = [];

	for (const [localId, payload] of buffer.entities) {
		localIdToType.set(localId, payload.type);
		const exact = await findEntityBySourceRef(
			db,
			params.universeId,
			params.sourceSystem,
			payload.sourceRef.path
		);
		const candidatePool = exact
			? []
			: await candidateEntitiesForMatching(db, params.universeId, payload.type);

		const decision = await resolveMatch({
			subject: { name: payload.name, aliases: payload.aliases },
			exactSourceRefMatch: exact
				? { id: exact.entityId, name: exact.name, aliases: exact.aliases }
				: null,
			candidates: candidatePool,
			similarity: params.similarity,
			thresholds: params.thresholds
		});

		if (decision.outcome === 'exact' || decision.outcome === 'match') {
			localIdToEntityId.set(localId, decision.candidateId);
			resolved.push({
				localId,
				candidate: {
					kind: 'update',
					targetEntityId: decision.candidateId,
					rationale: `Re-imported from "${payload.sourceRef.path}" - matched an existing entity.`,
					evidence: matchEvidence(
						documentId,
						payload,
						decision.outcome === 'match' ? decision.similarity : null,
						[]
					),
					rank: resolved.length
				},
				patch: { name: payload.name, aliases: payload.aliases, after: payload.summary }
			});
		} else {
			const ambiguousCandidateIds = decision.outcome === 'ask' ? decision.candidateIds : [];
			resolved.push({
				localId,
				candidate: {
					kind: 'create',
					targetEntityId: null,
					rationale:
						decision.outcome === 'ask'
							? `Extracted from "${payload.sourceRef.path}" - ambiguous match against ${ambiguousCandidateIds.length} existing entities, needs a human decision.`
							: `Extracted from "${payload.sourceRef.path}" as a new entity.`,
					evidence: matchEvidence(
						documentId,
						payload,
						decision.outcome === 'ask' ? decision.similarity : null,
						ambiguousCandidateIds
					),
					rank: resolved.length
				},
				patch: {
					type: payload.type,
					name: payload.name,
					slug: slugify(payload.name),
					aliases: payload.aliases,
					body: payload.summary
				}
			});
		}
	}

	const relationCandidates: Array<{ candidate: CreateProposalPlanCandidate; patch: unknown }> = [];
	for (const relationPayload of buffer.relations) {
		const fromEntityId = localIdToEntityId.get(relationPayload.fromLocalId);
		const toEntityId = localIdToEntityId.get(relationPayload.toLocalId);
		const fromType = localIdToType.get(relationPayload.fromLocalId);
		const toType = localIdToType.get(relationPayload.toLocalId);
		// See this module's doc comment: a relation to a not-yet-existing entity has no
		// real id to reference and is dropped for this run, not invented a workaround for.
		if (!fromEntityId || !toEntityId || !fromType || !toType) continue;

		const type = await findOrCreateRelationType(db, {
			universeId: params.universeId,
			label: relationPayload.label,
			inverseLabel: relationPayload.inverseLabel,
			cardinality: relationPayload.cardinality,
			allowedFrom: fromType,
			allowedTo: toType
		});
		relationCandidates.push({
			candidate: {
				kind: 'relation',
				targetEntityId: fromEntityId,
				relationTypeId: type.id,
				relatedEntityId: toEntityId,
				rationale: `Re-imported from "${relationPayload.sourceRef.path}".`,
				evidence: {
					documentId,
					sourceRef: relationPayload.sourceRef,
					evidenceSpan: relationPayload.evidenceSpan
				},
				rank: resolved.length + relationCandidates.length
			},
			patch: {}
		});
	}

	const allCandidates = [
		...resolved.map((r) => r.candidate),
		...relationCandidates.map((r) => r.candidate)
	];
	if (allCandidates.length === 0) return 0;

	const { proposals } = await createProposalPlan(db, {
		universeId: params.universeId,
		trigger: 'import',
		summary: `Import: ${resolved.length} entit${resolved.length === 1 ? 'y' : 'ies'}, ${relationCandidates.length} relation(s) from document "${documentId}".`,
		candidateCap: allCandidates.length,
		estimatedCredits: 0,
		candidates: allCandidates
	});

	const allPatches = [...resolved.map((r) => r.patch), ...relationCandidates.map((r) => r.patch)];
	await Promise.all(
		proposals.map((row: ProposalRow, index: number) =>
			isEmptyPatchTarget(allPatches[index])
				? Promise.resolve()
				: recordProposalDiff(db, {
						proposalId: row.id,
						patch: allPatches[index],
						provider: 'import',
						modelId: params.playbook.id,
						credits: 0
					})
		)
	);

	return proposals.length;
}

function isEmptyPatchTarget(patch: unknown): boolean {
	return typeof patch === 'object' && patch !== null && Object.keys(patch).length === 0;
}

function matchEvidence(
	documentId: string,
	payload: EntityProposalPayload,
	similarity: number | null,
	ambiguousCandidateIds: string[]
): unknown {
	return {
		documentId,
		sourceRef: payload.sourceRef,
		evidenceSpan: payload.evidenceSpan,
		similarity,
		ambiguousCandidateIds
	};
}

// ---------------------------------------------------------------------------
// Accept + source-ref bookkeeping, re-exported for review flows (issue #36): the review
// UI's accept action should call this rather than @canonry/db's bare acceptImportProposal
// so entity_source_ref always lands with the same call that writes the entity.
// ---------------------------------------------------------------------------

export type { AcceptImportProposalInput };
export const acceptImportProposal = dbAcceptImportProposal;
