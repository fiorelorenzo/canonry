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
 * Six responsibilities, one per acceptance criterion of this wave (the sixth added by
 * issue #133):
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
 * - **Matching and proposal persistence** (issues #36, #37, #160, §6.1's merge-engine
 *   line): every entity a document proposes is resolved through `resolveMatch` before it
 *   becomes a `proposal` row - exact source ref first, semantic similarity after, never
 *   a silent guess in the in-between band. The candidate pool for that similarity step is
 *   committed canon *and* this same job's own still-pending `create` proposals (issue
 *   #160): a document that names an entity a document earlier in this job already
 *   introduced folds into that pending proposal instead of writing a second, colliding
 *   one - `materializeDocumentProposals`'s own comment has the detail.
 * - **Relation vocabulary** (decision K1, issue #190): every relation's label is
 *   resolved through `@canonry/copilot`'s `resolveRelationType` before it becomes a
 *   `proposal` row - only its `'existing'` outcome may be used without a human
 *   (guardrail 1: a relation type is content, not configuration). The other three
 *   outcomes never write a `relation_type` row from here; they become a vocabulary
 *   proposal a GM accepts, one per distinct question per job rather than one per
 *   relation - `proposeRelationTypeVocabulary`'s own comment has the detail.
 * - **Cost attribution** (issue #133): every `usage` event a driver yields writes its own
 *   `model_call` row (agent `'import'`, operation naming the step's purpose) via
 *   `@canonry/ai`'s `recordCall` - real tokens and real euro cost, but zero credits,
 *   since the user is charged once per document below rather than once per call. The
 *   one real charge (`spendCredits`, `operation: 'import.document'`, unchanged from
 *   before this issue) now points its `credit_transaction` row at the document's most
 *   recent `model_call` row instead of leaving `model_call_id` null.
 *
 * **A relation whose ends this same job is still only proposing** (issue #613). This used to
 * be a stated scope boundary: `proposal.kind = 'relation'` wanted two real entity ids, and a
 * relation that had neither was dropped, on the reasoning that the entities were still
 * proposed and a later import would supply the link. That reasoning held while a relation was
 * an occasional edge between two documents. It stopped holding when #603 made the point of
 * reading `.one` the parent/subpage tree, which arrives whole on run one: measured on a real
 * notebook, 203 of 203 relations had both ends new and every one was thrown away, tokens paid
 * for and output discarded.
 *
 * So an endpoint may now be a *proposal* rather than an entity
 * (`proposal.target_entity_proposal_id` / `related_entity_proposal_id`, whose comment in
 * `packages/db`'s `schema/proposal.ts` carries the state table). The relation is a real,
 * pending `relation` proposal from the moment this file writes it: in the queue, showing its
 * own evidence, rejectable. Three pieces, and nothing else:
 *
 *  - here, `RelationEndpoint` says which of the three shapes each end is (an existing
 *    entity, a pending `create` an earlier document folded onto, or a `create` in this same
 *    document's plan, which has no id until `createProposalPlan` chooses one and therefore
 *    travels as an index into that plan);
 *  - `acceptProposal` on the entry at one end fills that end's entity id in
 *    (`resolveRelationEndpoints`). That writes no relation and touches no canon: it swaps a
 *    pointer on a row that stays `pending`, and the relation still reaches canon only through
 *    its own accept, with its own allowed_from/allowed_to check (#191). Guardrail 1 is why it
 *    is a pointer swap and not a cascade that writes the edge;
 *  - `rejectProposal` on that entry settles the relations that can now never resolve as
 *    `superseded`, so nothing sits pending forever pointing at an entry that will not exist.
 *
 * Two drops remain, and both are drops because no accept order reaches them: an endpoint the
 * engine declined outright (a bare mention, issue #479, or a local id the model named in a
 * relation without ever proposing an entity for it), and both ends landing on the *same*
 * entry (issue #160), which `relation_from_ne_to` would refuse anyway.
 */
import { createHash } from 'node:crypto';
import {
	acceptAnyImportProposal as dbAcceptAnyImportProposal,
	acceptImportProposal as dbAcceptImportProposal,
	admitImportJob,
	candidateEntitiesForMatching,
	checkImportQuota,
	createImportJob,
	createProposalPlan,
	findEntityBySourceRef,
	entitiesByIdentity,
	entityUpdateTargetsByIds,
	foldEntitySightingIntoPendingProposal,
	getBalance,
	getImportJob,
	importQuotaForUser,
	importUsageForUser,
	isRelationTypeProposalKind,
	pendingEntityProposalsByIdentity,
	pendingEntityProposalsForJob,
	proposeRelationTypeVocabulary,
	queuePositionFor,
	recordEntitySourceRef,
	recordProposalDiff,
	settleImportJob,
	spendCredits,
	syncMissingEntitySourceRefs,
	updateImportJobCheckpoint,
	type AcceptImportProposalInput,
	type CreateImportJobInput,
	type CreateProposalPlanCandidate,
	type Db,
	type ImportJobRow,
	type MatchCandidatePool,
	type MatchCandidateRow,
	type ProposalRow,
	type RelationTypeVocabResolutionInput
} from '@canonry/db';
import {
	resolveRelationType,
	type Embedder,
	type RelationTypeResolution,
	IMPORT_RATIONALE_EXTRACTED,
	IMPORT_RATIONALE_AMBIGUOUS,
	IMPORT_RATIONALE_MATCHED,
	IMPORT_RATIONALE_RELATION
} from '@canonry/copilot';
import type { Locale } from '@canonry/lang';
import { chargeFor, recordCall } from '@canonry/ai';
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
import {
	oneLineSummary,
	resolveMatch,
	type IdentityCandidate,
	type MatchCandidate,
	type MatchThresholds,
	type SimilarityFn
} from './matching.js';
import {
	bodyWriteVerdict,
	isBareMention,
	pruneForeignAliases,
	updatePatchAddsNothing
} from './proposal-guards.js';
import type {
	OutcomeNoteLossy,
	OutcomeNoteOffender,
	OutcomeNotePayload,
	OutcomeNoteSkippedImages
} from './outcome-note.js';

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

/** What a checkpoint entry can say about one document. `skipped_unchanged` is not a
 * `DocumentStatus`, deliberately: no driver ever emits it, because it is this runner's own
 * record that it never handed the document to a driver at all. It used to be written as
 * `finished`, which made a skipped document indistinguishable from one that ran and let a
 * partial re-import divide its real spend by all its documents (issue #620). Both are
 * terminal for a resume: neither is re-run when `run` is called again on the same job. */
type CheckpointDocumentStatus = DocumentStatus | 'skipped_unchanged';

interface CheckpointShape {
	documents: Record<string, { status: CheckpointDocumentStatus }>;
}

function readCheckpoint(value: unknown): CheckpointShape {
	if (typeof value !== 'object' || value === null) return { documents: {} };
	const record = value as Record<string, unknown>;
	const documents = record.documents;
	if (typeof documents !== 'object' || documents === null) return { documents: {} };
	return { documents: documents as Record<string, { status: CheckpointDocumentStatus }> };
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
	/** Issue #189/#190, decision K1: the embedder `resolveRelationType` uses for its
	 * semantic rung, injected exactly like `similarity` above rather than imported, so
	 * this stays testable without a real gateway credential. */
	embedRelationLabel: Embedder;
	/** issue #26: this job cancels itself once this many milliseconds of wall clock pass,
	 * independent of whatever HTTP request or browser tab started it. */
	timeoutMs: number;
	/** issue #263: the reader's interface locale, threaded into each proposal's
	 * deterministic `rationale` (speech.ts's `IMPORT_RATIONALE_*`) and recorded on
	 * `proposal.locale` exactly like every other row this codebase writes speech into.
	 * Optional and defaulting to `'en'` so a caller with no request-scoped locale (a
	 * script, a test) still gets a real sentence rather than an unset one. */
	locale?: Locale;
}

/**
 * Why the relations one document proposed did not become `relation` proposals (issue
 * #613). Broken down rather than counted as one number, because the breakdown is the
 * whole question: a relation whose two ends are both entities this same job is proposing
 * becomes proposable the moment the GM accepts them, while one whose end the engine
 * declined outright has no accept order that reaches it. #573 already counted the total;
 * counting only the total is what made the loss look like an edge case for two releases.
 */
export interface RelationDropLedger {
	/** Every relation this document proposed that did not become a pending `relation`
	 * proposal in its own plan: the sum of the five fields below. A relation held for a
	 * vocabulary question (decision K1) is not in here at all - it is waiting on a
	 * proposal the GM can already see, which is not a drop. */
	total: number;
	/** Both endpoints are entities this job proposes and has not written yet. */
	bothEndsProposed: number;
	/** One endpoint is canon that already exists, the other is one of this job's own
	 * pending proposals. */
	oneEndProposed: number;
	/** At least one endpoint is neither: the engine declined that sighting (a bare
	 * mention, issue #479) or the model named a local id it never proposed an entity
	 * for. No accept order reaches this one. */
	noEndProposed: number;
	/** Both endpoints resolved onto the same entity (issue #160). Never proposable at
	 * all: `relation_from_ne_to` refuses a self-loop. */
	selfLoop: number;
	/** Endpoints that are not real yet but were parked against the proposals that will
	 * make them real, so accepting those unblocks the relation into its own proposal.
	 * Counted apart from the drops above because it is the opposite of a drop. */
	deferred: number;
}

export function newRelationDropLedger(): RelationDropLedger {
	return {
		total: 0,
		bothEndsProposed: 0,
		oneEndProposed: 0,
		noEndProposed: 0,
		selfLoop: 0,
		deferred: 0
	};
}

export interface DocumentOutcome {
	documentId: string;
	/** issue #177: `JobDocument.sourcePath`, the file a GM actually wrote and would
	 * recognise - `outcome_note` names a document by this rather than by `documentId`
	 * (an opaque `doc-1`) because it is read on a review screen, not a log. */
	sourcePath: string;
	status: DocumentStatus | 'skipped_unchanged';
	entityCount: number;
	relationCount: number;
	proposalsCreated: number;
	/** issue #212: tool calls in this document's steps that came back invalid and were
	 * skipped rather than executed, summed across every `partial_loss` event the run
	 * emitted for it (gateway-driver.ts, guardrail 3). Zero for a clean run and for
	 * `skipped_unchanged`, which never ran a step at all. */
	lostToolCallCount: number;
	/** issue #623: images this document carried that Canonry does not store, in the order
	 * they were refused. Empty for a clean run and for `skipped_unchanged`, which never
	 * ran a step. A skip does not stop the document, so this is the only record that the
	 * export held a picture the GM will not find in the library. */
	skippedImages: { path: string; format: string }[];
	/** issue #613: what became of the relations this document proposed. All zeroes for a
	 * document that never reached the merge engine (`skipped_unchanged`, `cancelled`,
	 * `failed`), which is the honest answer for one: nothing became of them because
	 * nothing was decided. */
	droppedRelations: RelationDropLedger;
	/** issue #627: sightings in this document whose candidate pool was capped, so the merge
	 * decision that followed saw part of the universe or part of the job rather than all of
	 * it. Zero is the normal answer and the one every import under the cap gives; a non-zero
	 * count is what says a fold rate measured on this run is not comparable with one measured
	 * on a smaller universe. */
	truncatedPools: number;
	/** issue #177: the settling `progress` event's own `detail` (issue #169 made every
	 * terminal status specific and legible - "stuck in a loop: source_list was called
	 * with identical arguments 4 times in a row..." rather than a generic "this
	 * document's step ceiling was reached") - threaded up so the job's own
	 * `outcomeNote` can name why a document did not finish cleanly instead of only
	 * counting it. `skipped_unchanged` never went through the driver, so it carries a
	 * literal note rather than a driver-authored one. */
	detail: string;
}

/** `DocumentOutcome.detail` is drawn from a small closed set of literal strings
 * `gateway-driver.ts`'s `runDocument` and `tools.ts`'s loop guard yield (this module's
 * own `'never started'` and `'unchanged since the last import'` join that set) - matched
 * here rather than threaded as a code from the driver, since the driver's own progress
 * events are consumed by more than this function and changing their shape is a bigger
 * move than this issue asks for. Anything that does not match (there is currently
 * exactly one such literal, `model call failed: ${errorName}`, itself pattern-matched
 * below) falls back to `'other'` with the raw text kept as a last resort. */
function classifyOffenderDetail(detail: string): Omit<OutcomeNoteOffender, 'path' | 'othersCount'> {
	switch (detail) {
		case "this document's step ceiling was reached":
			return { reason: 'step_ceiling' };
		case 'cancelled before this step started':
			return { reason: 'cancelled_before_step' };
		case 'cancelled mid-step':
			return { reason: 'cancelled_mid_step' };
		case 'every tool call in this step failed to parse, most likely truncated by the output limit':
			return { reason: 'tool_calls_unparseable' };
		case "this step's worst case would not fit this job's remaining credit budget":
			return { reason: 'step_worst_case_exceeds_budget' };
		case "this job's credit budget is exhausted":
			return { reason: 'job_budget_exhausted' };
		case 'never started':
			return { reason: 'never_started' };
	}
	const modelFailed = /^model call failed: (.+)$/.exec(detail);
	if (modelFailed) return { reason: 'model_call_failed', errorName: modelFailed[1] ?? '' };
	const loop =
		/^stuck in a loop: (.+) was called with identical arguments (\d+) times in a row, so this document was ended rather than run to its step ceiling$/.exec(
			detail
		);
	if (loop)
		return { reason: 'loop_guard', toolName: loop[1] ?? '', loopCount: Number(loop[2] ?? 0) };
	return { reason: 'other', text: detail };
}

/** Merges the optional suffixes into a payload's JSON string only when there is one -
 * `exactOptionalPropertyTypes` treats a present `lossy: undefined` key differently from
 * an absent one, and `OutcomeNotePayload` wants the latter, so this builds the object up
 * instead of assigning possibly-`undefined` properties. Three call sites below, one per
 * payload kind that carries a suffix. */
function stringifyWithSuffixes(
	base: Record<string, unknown>,
	lossy: OutcomeNoteLossy | undefined,
	skippedImages: OutcomeNoteSkippedImages | undefined
): string {
	return JSON.stringify({
		...base,
		...(lossy ? { lossy } : {}),
		...(skippedImages ? { skippedImages } : {})
	});
}

/** issue #177, guardrail 7 ("the product says what did not add up, it never
 * certifies that anything is fine"): a job that did not finish cleanly names the
 * document that stopped it, not only a count. Several outstanding documents
 * name the first and say how many others there were, rather than an unbounded
 * sentence - `outcome_note` is one line on a review screen, not a log. */
function buildOutcomeNote(
	documentsToRun: JobDocument[],
	outcomes: DocumentOutcome[],
	proposalsEmitted: number,
	finalStatus: RunImportJobResult['finalStatus']
): string {
	// issue #212, guardrail 7: a document can lose tool calls to a step's output limit
	// without ever becoming one of the "unfinished" documents below - the model still
	// gets its step budget to retry narrower, and the document usually still finishes.
	// Computed once, up front, so every branch below can attach it instead of only the
	// branch its author happened to be thinking about staying honest about it.
	const lossy = outcomes.filter((outcome) => outcome.lostToolCallCount > 0);
	const [firstLoss, ...restLoss] = lossy;
	const lossyPayload: OutcomeNoteLossy | undefined = firstLoss
		? {
				path: firstLoss.sourcePath,
				count: firstLoss.lostToolCallCount,
				othersCount: restLoss.length
			}
		: undefined;

	// issue #623: same argument as `lossy` above, and the same reason it is computed here
	// rather than inside one branch: a document that skipped an image almost always still
	// finishes, so the `finished` branch is exactly the one that has to say so.
	const skipped = outcomes.flatMap((outcome) => outcome.skippedImages);
	const [firstSkip] = skipped;
	const skippedPayload: OutcomeNoteSkippedImages | undefined = firstSkip
		? { path: firstSkip.path, format: firstSkip.format, count: skipped.length }
		: undefined;

	if (finalStatus === 'finished') {
		return stringifyWithSuffixes(
			{ v: 1, kind: 'finished', documents: outcomes.length, proposals: proposalsEmitted },
			lossyPayload,
			skippedPayload
		);
	}

	const unfinished = outcomes.filter(
		(outcome) => outcome.status !== 'finished' && outcome.status !== 'skipped_unchanged'
	);
	// A job-wide credit ceiling can stop the driver's outer loop before the next
	// document is even started (gateway-driver.ts's `startJob` checks the ceiling
	// between documents, not just within one), so nothing terminal is ever reported
	// for it - named here as "never started" instead of silently dropped from the note.
	const settledIds = new Set(outcomes.map((outcome) => outcome.documentId));
	const neverStarted = documentsToRun.filter((doc) => !settledIds.has(doc.id));

	const offenders = [
		...unfinished.map((outcome) => ({ path: outcome.sourcePath, detail: outcome.detail })),
		...neverStarted.map((doc) => ({ path: doc.sourcePath, detail: 'never started' }))
	];
	const [first, ...rest] = offenders;
	if (!first) {
		// Every branch that sets finalStatus to something other than 'finished' also
		// puts at least one entry into unfinished or neverStarted, so this is not
		// reachable - kept honest rather than silent if that ever stops being true.
		return stringifyWithSuffixes(
			{
				v: 1,
				kind: 'stopped_no_offender',
				documents: outcomes.length,
				proposals: proposalsEmitted
			},
			lossyPayload,
			skippedPayload
		);
	}
	return stringifyWithSuffixes(
		{
			v: 1,
			kind: 'offender',
			offender: {
				path: first.path,
				othersCount: rest.length,
				...classifyOffenderDetail(first.detail)
			}
		},
		lossyPayload,
		skippedPayload
	);
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
	 * `finished` or `skipped_unchanged` are skipped, and a document whose content is
	 * unchanged since the last import of the same source ref is skipped before the driver
	 * ever sees it. */
	async run(params: RunImportJobParams): Promise<RunImportJobResult> {
		const { db } = params;
		const jobRow = await getImportJob(db, params.dbJobId);
		const checkpoint = readCheckpoint(jobRow.checkpoint);

		const outcomes: DocumentOutcome[] = [];
		const documentsToRun: JobDocument[] = [];
		const contentHashByDocument = new Map<string, string>();
		for (const doc of params.documents) {
			const recorded = checkpoint.documents[doc.id]?.status;
			if (recorded === 'finished' || recorded === 'skipped_unchanged') continue;

			const contentHash = await hashOf(params.sources, doc.sourcePath);
			contentHashByDocument.set(doc.id, contentHash);
			const existing = await findEntityBySourceRef(
				db,
				params.universeId,
				params.sourceSystem,
				doc.sourcePath
			);
			if (existing && existing.contentHash === contentHash) {
				outcomes.push({
					documentId: doc.id,
					sourcePath: doc.sourcePath,
					status: 'skipped_unchanged',
					entityCount: 0,
					relationCount: 0,
					proposalsCreated: 0,
					droppedRelations: newRelationDropLedger(),
					truncatedPools: 0,
					lostToolCallCount: 0,
					skippedImages: [],
					detail: 'unchanged since the last import'
				});
				// Not `finished`: this document cost nothing, and `estimate.ts` divides a
				// job's real spend by the documents that did cost something (issue #620).
				checkpoint.documents[doc.id] = { status: 'skipped_unchanged' };
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
				outcomeNote: JSON.stringify(
					outcomes.length > 0
						? ({ v: 1, kind: 'unchanged', documents: outcomes.length } satisfies OutcomeNotePayload)
						: ({ v: 1, kind: 'no_documents' } satisfies OutcomeNotePayload)
				),
				proposalsEmitted: 0
			});
			await syncMissingAfterSettle(params, settled.job.status, params.dbJobId);
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
		const sourcePathByDocument = new Map(documentsToRun.map((doc) => [doc.id, doc.sourcePath]));
		const partialLossByDocument = new Map<string, number>();
		const skippedImagesByDocument = new Map<string, { path: string; format: string }[]>();
		const lastModelCallIdByDocument = new Map<string, string>();
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
					contentHashByDocument,
					sourcePathByDocument,
					partialLossByDocument,
					skippedImagesByDocument,
					lastModelCallIdByDocument,
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
		const settled = await settleImportJob(db, params.dbJobId, {
			status: finalStatus,
			outcomeNote: buildOutcomeNote(documentsToRun, outcomes, proposalsEmitted, finalStatus),
			proposalsEmitted
		});
		await syncMissingAfterSettle(params, settled.job.status, params.dbJobId);

		return { jobId: params.dbJobId, finalStatus, documents: outcomes, proposalsEmitted };
	}
}

/** issue #163, SPEC.md §6.4: only a job whose *authoritative* settled status is
 * `finished` gets to mark anything missing - "we did not get to it"
 * (`stopped_at_ceiling`, `cancelled`, `failed`) and "it is gone" are different facts,
 * and marking on the wrong one tells a GM their canon vanished. Reads `settleImportJob`'s
 * own returned row rather than this run's locally computed `finalStatus`, so a settle
 * that lost a race (a concurrent cancel already moved the job to a final status before
 * this call landed) never marks anything either - "settles exactly once" (issue #26)
 * protects the job row; this reads that same protection rather than re-deciding on stale
 * local state.
 *
 * `touchedExternalIds` is the run's *full* document list (`params.documents`), not just
 * the ones this call actually reprocessed - a document a checkpoint resume already
 * marked `finished` in an earlier partial run is still part of the current export and
 * must not be treated as vanished. */
async function syncMissingAfterSettle(
	params: RunImportJobParams,
	settledStatus: ImportJobRow['status'],
	jobId: string
): Promise<void> {
	if (settledStatus !== 'finished') return;
	const touchedExternalIds = [...new Set(params.documents.map((doc) => doc.sourcePath))];
	await syncMissingEntitySourceRefs(params.db, {
		universeId: params.universeId,
		sourceSystem: params.sourceSystem,
		touchedExternalIds,
		importJobId: jobId
	});
}

interface HandleEventContext {
	params: RunImportJobParams;
	checkpoint: CheckpointShape;
	buffers: Map<string, DocumentBuffer>;
	documentPriceCredits: number;
	/** Populated once per document in `run()`, from the same `hashOf` call that already
	 * decides whether to skip it. Threaded down to `matchEvidence` so a later accept
	 * (`acceptImportProposal`, called from the review UI, not from this file) can record
	 * `entity_source_ref.content_hash` without re-reading the source document - the review
	 * screen has no `SourceReader` and should not need one just to accept a proposal. */
	contentHashByDocument: Map<string, string>;
	/** issue #177: `documentsToRun`'s own sourcePath, keyed by documentId - threaded down
	 * so `onDocumentSettled` can put `DocumentOutcome.sourcePath` on every terminal
	 * outcome without the driver's own `progress` event needing to carry it. */
	sourcePathByDocument: Map<string, string>;
	/** issue #212: running total of tool calls lost to partial parse failures, keyed by
	 * documentId - accumulated across every `partial_loss` event a document's run emits
	 * (a document can lose calls in more than one step) and read once, at the terminal
	 * `progress` event, onto that document's `DocumentOutcome.lostToolCallCount`. */
	partialLossByDocument: Map<string, number>;
	/** issue #623: images this document's run refused on format grounds, keyed by
	 * documentId, in the order they were skipped - accumulated across every
	 * `image_skipped` event and read once, at the terminal `progress` event, onto that
	 * document's `DocumentOutcome.skippedImages`. */
	skippedImagesByDocument: Map<string, { path: string; format: string }[]>;
	/** issue #133: the id of the most recent `model_call` row written for this document,
	 * one written per `usage` event as it arrives (real per-call tokens and cost, agent
	 * 'import', zero credits since the user is charged once per document below, never per
	 * call). Read once, at the terminal `progress` event, so the flat per-document
	 * `spendCredits` charge points at a real row from this document's own run instead of
	 * leaving `credit_transaction.model_call_id` null. */
	lastModelCallIdByDocument: Map<string, string>;
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
		const modelCallId = await recordCall(ctx.params.db, {
			userId: ctx.params.userId,
			universeId: ctx.params.universeId,
			agent: 'import',
			// issue #133: identifies which kind of step this call was (the playbook's own
			// purpose tier - a plain extraction pass, a hard document escalated to premium,
			// or a page image read multimodally), so the rows this writes are groupable by
			// step rather than one undifferentiated blob per job.
			operation: `import.${event.purpose}`,
			provider: event.provider,
			modelId: event.modelId,
			inputTokens: event.inputTokens,
			outputTokens: event.outputTokens,
			embeddingTokens: 0,
			// Never charged individually - see spendCredits's modelCallId doc comment for
			// why the flat per-document charge below stays the only real spend. Real cost
			// still lands on costEur, computed the same computeCost path every other agent
			// uses (gateway-driver.ts), so the margin question stays answerable per call.
			credits: 0,
			costEur: event.costEur,
			latencyMs: event.latencyMs,
			requestId: null
		});
		ctx.lastModelCallIdByDocument.set(event.documentId, modelCallId);
		return;
	}

	if (event.type === 'partial_loss') {
		ctx.partialLossByDocument.set(
			event.documentId,
			(ctx.partialLossByDocument.get(event.documentId) ?? 0) + event.lostToolCallCount
		);
		return;
	}

	if (event.type === 'image_skipped') {
		const skipped = ctx.skippedImagesByDocument.get(event.documentId) ?? [];
		skipped.push({ path: event.path, format: event.format });
		ctx.skippedImagesByDocument.set(event.documentId, skipped);
		return;
	}

	if (event.type !== 'progress' || !DOCUMENT_TERMINAL_STATUSES.includes(event.status)) return;

	let proposalsCreated = 0;
	let relationDrops = newRelationDropLedger();
	let truncatedPools = 0;
	const buffer = ctx.buffers.get(event.documentId);
	if (buffer && (event.status === 'finished' || event.status === 'stopped_at_ceiling')) {
		const materialized = await materializeDocumentProposals(
			ctx.params,
			event.documentId,
			buffer,
			ctx.contentHashByDocument.get(event.documentId) ?? '',
			event.status
		);
		proposalsCreated = materialized.proposalsCreated;
		relationDrops = materialized.relationDrops;
		truncatedPools = materialized.truncatedPools;
		if (proposalsCreated > 0 && ctx.params.userId) {
			await spendCredits(ctx.params.db, {
				userId: ctx.params.userId,
				universeId: ctx.params.universeId,
				operation: 'import.document',
				credits: ctx.documentPriceCredits,
				idempotencyKey: `import-document:${ctx.params.dbJobId}:${event.documentId}`,
				modelCallId: ctx.lastModelCallIdByDocument.get(event.documentId) ?? null
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
		sourcePath: ctx.sourcePathByDocument.get(event.documentId) ?? '',
		status: event.status,
		entityCount: event.entityCount,
		relationCount: event.relationCount,
		proposalsCreated,
		droppedRelations: relationDrops,
		truncatedPools,
		lostToolCallCount: ctx.partialLossByDocument.get(event.documentId) ?? 0,
		skippedImages: ctx.skippedImagesByDocument.get(event.documentId) ?? [],
		detail: event.detail
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

/** What one document's materialisation produced, for the outcome the run reports. The
 * count was the whole return value until issue #613 needed the relation ledger beside
 * it, and the two travel together because they come out of the same pass. */
interface MaterializeResult {
	proposalsCreated: number;
	relationDrops: RelationDropLedger;
	truncatedPools: number;
}

/**
 * One end of a relation this document proposed, in the three shapes it can actually be
 * (issue #613). Nothing else is a valid endpoint: a local id that is none of these has no
 * entry behind it at all and its relation is dropped.
 *
 *  - `entity`: canon that already exists, either matched by source ref or by the merge
 *    engine. The only shape that existed before this issue, and the only one that can be
 *    accepted immediately.
 *  - `proposal`: a still-pending `create` an *earlier* document in this same job wrote,
 *    which this document's sighting folded into (issue #160). Its id is real, so it goes
 *    straight onto the relation row.
 *  - `candidate`: a `create` this same document is about to write, identified by its index
 *    in the plan being built, because that is the only handle that exists before
 *    `createProposalPlan` has chosen the ids. `createProposalPlan` resolves it inside its
 *    own transaction.
 */
type RelationEndpoint =
	| { kind: 'entity'; entityId: string }
	| { kind: 'proposal'; proposalId: string }
	| { kind: 'candidate'; index: number };

/** A relation whose type is an unanswered vocabulary question (decision K1), held until
 * the plan exists. It cannot be written inside the relation loop any more: an endpoint of
 * kind `candidate` has no id until `createProposalPlan` has run, and the vocabulary
 * proposal's patch is jsonb that has to carry a durable reference rather than an index
 * into a local array. */
interface VocabularyWaitingRelation {
	resolution: RelationTypeVocabResolutionInput;
	from: RelationEndpoint;
	to: RelationEndpoint;
	rationale: string;
	evidence: unknown;
}

function endpointFor(
	localId: string,
	localIdToEntityId: Map<string, string>,
	localIdToCandidate: Map<string, RelationEndpoint>
): RelationEndpoint | null {
	const entityId = localIdToEntityId.get(localId);
	if (entityId) return { kind: 'entity', entityId };
	return localIdToCandidate.get(localId) ?? null;
}

/** Whether both ends of a relation land on the same entry, whichever shape they arrived
 * in. Two `candidate` ends are never equal: each `create` takes its own index. */
function sameEndpoint(a: RelationEndpoint, b: RelationEndpoint): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'entity' && b.kind === 'entity') return a.entityId === b.entityId;
	if (a.kind === 'proposal' && b.kind === 'proposal') return a.proposalId === b.proposalId;
	return false;
}

/** The `CreateProposalPlanCandidate` fields one end contributes. An `entity` end
 * contributes none of them: its id is already on `targetEntityId`/`relatedEntityId`, and a
 * present-but-undefined key is not the same as an absent one under
 * `exactOptionalPropertyTypes`, which is why this returns a spread rather than assigning. */
function endpointRefs(
	side: 'target' | 'related',
	endpoint: RelationEndpoint
): Partial<CreateProposalPlanCandidate> {
	if (endpoint.kind === 'entity') return {};
	if (endpoint.kind === 'proposal') {
		return side === 'target'
			? { targetEntityProposalId: endpoint.proposalId }
			: { relatedEntityProposalId: endpoint.proposalId };
	}
	return side === 'target'
		? { targetEntityProposalIndex: endpoint.index }
		: { relatedEntityProposalIndex: endpoint.index };
}

/** The endpoint's real proposal id, once the plan has been written. A `candidate` end is
 * resolved through the plan's own returned rows, in the same order they were passed in. */
function endpointProposalId(endpoint: RelationEndpoint, proposals: ProposalRow[]): string | null {
	if (endpoint.kind === 'entity') return null;
	if (endpoint.kind === 'proposal') return endpoint.proposalId;
	const row = proposals[endpoint.index];
	if (!row) {
		throw new Error(
			`materializeDocumentProposals: relation endpoint names candidate ${endpoint.index}, which the plan did not return`
		);
	}
	return row.id;
}

/** Writes (or folds into) one vocabulary proposal per queued relation, once the plan's own
 * `create` rows have ids. Sequential rather than `Promise.all`, and that is the point:
 * `proposeRelationTypeVocabulary` folds a repeat sighting into the proposal a previous call
 * created, so two concurrent calls asking the same question would both find nothing and both
 * create one, which is the "twelve relations, twelve questions" shape decision K1 exists to
 * avoid. */
async function writeVocabularyProposals(
	params: RunImportJobParams,
	waiting: VocabularyWaitingRelation[],
	proposals: ProposalRow[]
): Promise<void> {
	for (const item of waiting) {
		await proposeRelationTypeVocabulary(params.db, {
			universeId: params.universeId,
			importJobId: params.dbJobId,
			resolution: item.resolution,
			relation: {
				fromEntityId: item.from.kind === 'entity' ? item.from.entityId : null,
				fromProposalId: endpointProposalId(item.from, proposals),
				toEntityId: item.to.kind === 'entity' ? item.to.entityId : null,
				toProposalId: endpointProposalId(item.to, proposals),
				rationale: item.rationale,
				evidence: item.evidence
			},
			provider: 'import',
			modelId: params.playbook.id
		});
	}
}

/** Translates `@canonry/copilot`'s `RelationTypeResolution` into the plain shape
 * `@canonry/db`'s `proposeRelationTypeVocabulary` accepts - `packages/db` stays free of
 * a dependency on `@canonry/copilot` (see import.ts's own comment on that boundary), so
 * this file, which already depends on both, is where the translation happens.
 * `existingTypeId` below is `resolution.type.id`, the row's uuid primary key, on purpose:
 * this becomes a foreign key write (`relation.relation_type_id` / `proposal.patch`'s
 * `existingTypeId`), and a foreign key always points at `id`, never at `relation_type.key`
 * - `key` (decision L1, #195) is for comparing identity across contexts that have no
 * shared row to join against (evidence paths, the reject signal), which this is not. */
function toVocabResolutionInput(
	resolution: Exclude<RelationTypeResolution, { kind: 'existing' }>
): RelationTypeVocabResolutionInput {
	switch (resolution.kind) {
		case 'reuse-proposed':
			return {
				kind: 'relation_type_reuse',
				existingTypeId: resolution.type.id,
				proposedLabel: resolution.proposedLabel,
				why: resolution.why
			};
		case 'widen-proposed':
			return {
				kind: 'relation_type_widen',
				existingTypeId: resolution.type.id,
				addFrom: resolution.addFrom ?? null,
				addTo: resolution.addTo ?? null,
				why: resolution.why
			};
		case 'new-proposed':
			return {
				kind: 'relation_type_new',
				label: resolution.label,
				inverseLabel: resolution.inverseLabel,
				cardinality: resolution.cardinality,
				fromType: resolution.from,
				toType: resolution.to,
				why: resolution.why
			};
	}
}

/**
 * The `MatchContext` (matching.ts) for one already-existing candidate: its own type, and one
 * line off the head of its body. No source sentence, because an already-imported entity has
 * no source document text kept anywhere - `entity_source_ref` records which document it came
 * from and its hash, never the text.
 */
function toMatchCandidate(row: MatchCandidateRow): MatchCandidate {
	return {
		id: row.id,
		name: row.name,
		aliases: row.aliases,
		context: {
			type: row.type,
			summary: oneLineSummary(row.bodyLead),
			sourceSentence: null
		}
	};
}

/** Neither pool is read at all when an external id already settled the sighting (SPEC.md
 * §6.4 step 1 short-circuits step 2), and "not read" is not a truncated read. */
const EMPTY_POOL: MatchCandidatePool = { candidates: [], truncated: false };

/**
 * The text of every document this buffer's entities point at, for the source sentence half of
 * their `MatchContext` (issue #310).
 *
 * One read per distinct path, dropped as soon as this document's proposals are materialised,
 * rather than caching every document's text for the length of the job: a vault is hundreds of
 * documents and only the current one's spans are ever sliced. Keyed by path rather than taken
 * from the first payload because `tools.ts` pins `sourceRef.documentId` to this run's document
 * and says nothing about the path, so a driver that proposed an entity against a second path
 * gets its own text rather than a span sliced out of the wrong string.
 *
 * A read that fails yields no entry and therefore no source sentence. Matching then scores
 * what it scored before this issue, which is the right failure: an import must not die because
 * a path that was readable during the hash pass is not readable now, and the alternative -
 * slicing a span out of some other document - would be a quotation of the wrong text.
 */
async function readSourceTextsForContext(
	params: RunImportJobParams,
	buffer: DocumentBuffer
): Promise<Map<string, string>> {
	const texts = new Map<string, string>();
	const paths = new Set<string>();
	for (const payload of buffer.entities.values()) paths.add(payload.sourceRef.path);
	for (const path of paths) {
		try {
			const { content } = await params.sources.read(path);
			texts.set(path, content);
		} catch {
			// See this function's own comment: no context beats the wrong context.
		}
	}
	return texts;
}

/** The slice `evidenceSpan` names, out of the same string `source_read` returned to the
 * driver (playbooks state the span is an offset range into that text). Clamped rather than
 * trusted: a span past the end is what a truncated read produces, and `undefined` is what a
 * failed read produces. */
function spanText(text: string | undefined, span: { start: number; end: number }): string | null {
	if (!text) return null;
	const start = Math.min(Math.max(span.start, 0), text.length);
	const end = Math.min(Math.max(span.end, start), text.length);
	const sliced = text.slice(start, end).trim();
	return sliced.length > 0 ? sliced : null;
}

/** The names that belong to somebody else, for `pruneForeignAliases` (issue #479): every
 * other entity this document proposed, plus every entity or pending create the identity
 * pool turned up that this payload did *not* resolve to.
 *
 * `resolvedId` is what the payload matched, or null for a create. Excluding it is what
 * keeps a legitimate alias alive: an entity whose own name came back from the identity
 * lookup must not have that name treated as a stranger's. */
function foreignNamesFor(
	payload: EntityProposalPayload,
	proposedInDocument: EntityProposalPayload[],
	identityCandidates: IdentityCandidate[],
	resolvedId: string | null
): string[] {
	return [
		...proposedInDocument
			.filter((other) => other !== payload && other.name !== payload.name)
			.map((other) => other.name),
		...identityCandidates.filter((row) => row.id !== resolvedId).map((row) => row.name)
	];
}

/**
 * What one document's sightings did when the engine declined them (issue #573), kept so
 * the end of `materializeDocumentProposals` can tell "the engine looked and deliberately
 * had nothing to propose" from "this run did not get to the end of it". Every field is a
 * reason to re-read the document on the next import; `ontoEntityIds` is the only one that
 * can earn it a skip, and only at size 1. See `declinedDocumentEarnsSourceRef`.
 */
interface DeclineLedger {
	/** The already-existing entities this document's declined sightings resolved onto,
	 * de-duplicated. Dynamic, and `.size` is the whole decision, so a `Set`. */
	ontoEntityIds: Set<string>;
	/** Sightings the engine declined with no existing entity behind them: a `create` whose
	 * body was a bare mention (issue #479). There is no entity for a source ref to point
	 * at, so the document is re-read. */
	withoutEntity: number;
	/** Sightings that folded into a still-pending create (issue #178). Those already
	 * carry this document's path and hash into the surviving proposal, so the accept
	 * writes the ref and this function must not write one first: the entity does not
	 * exist yet. */
	folded: number;
	/** issue #613: the per-reason breakdown of the relations this document did not get to
	 * propose. `relationDrops.total` is what `declinedDocumentEarnsSourceRef` reads, and
	 * it means what the single counter before it meant: work a later import can still
	 * recover, but only if the document is read again. */
	relationDrops: RelationDropLedger;
	/** Relation-type vocabulary proposals written for this document (decision K1, issue
	 * #190). They do not appear in `allCandidates`, so a document that produced one and
	 * nothing else did produce something, and is not a declined document at all. */
	vocabularyProposals: number;
}

function newDeclineLedger(): DeclineLedger {
	return {
		ontoEntityIds: new Set<string>(),
		withoutEntity: 0,
		folded: 0,
		relationDrops: newRelationDropLedger(),
		vocabularyProposals: 0
	};
}

/**
 * Whether a document that produced no proposal at all has earned the `entity_source_ref`
 * row that makes the next import skip it (issue #573).
 *
 * **The cost this exists for.** `entity_source_ref` was only ever written on accept, and
 * `run()`'s skip reads that table, so a document the engine deliberately produced nothing
 * for left no row, and every later import re-read it, re-ran the driver on it and paid for
 * the tokens again. Correctness was never affected (SPEC.md §6.4's acceptance test is that
 * the second run produces zero changes, and it did: the same nothing), which is why this is
 * a cost and §14-latency defect rather than a canon one.
 *
 * **Guardrail 1, argued rather than waved at.** This is a write with no proposal behind it,
 * so it has to stand where SPEC.md §6.4's named exception stands, and it stands narrower.
 * That exception writes a canon *field* when the source changed and the user never touched
 * it, and it is allowed because the merge engine and not a model made the write. This
 * writes no canon field at all: `entity_source_ref` is provenance (which system, which
 * document, which bytes), it carries no `revision`, nothing about the entity's body, name,
 * aliases or relations moves, and nothing reaches a player. The decision is taken by the
 * deterministic half of the pipeline SPEC.md §6.1 describes as "no model decides it": the
 * model's sighting only named an entity, and §6.4's matching plus #479's guards are what
 * concluded there was nothing to propose. What the write *can* do is stop the next import
 * reading a document, and that is why the conditions below are the conservative half of the
 * argument rather than a formality.
 *
 * **Every condition is "or else the document is read again".** Losing a document silently
 * is worse than paying for it twice, so an outcome that is ambiguous re-reads:
 *
 *  - the document reached `finished`, which in this pipeline means the model called
 *    `job_finish` (tools.ts is the only emitter of that status). `stopped_at_ceiling`,
 *    `cancelled` and `failed` never reach here as anything but a re-read, and the two that
 *    do reach this function are separated by `documentStatus`;
 *  - it produced no proposal of any kind, vocabulary proposals included;
 *  - nothing folded and no relation was dropped, both of which are work a later import can
 *    still recover but only if it reads the document;
 *  - every declined sighting resolved onto an already-existing entity, and onto exactly
 *    **one** of them. This is the condition that is not obvious. `entity_source_ref` is
 *    unique on `(source_system, external_id)`, so one document path can hold one row and
 *    that row names one entity, and `findEntityBySourceRef` is §6.4 step 1: `resolveMatch`
 *    returns `exact` on it without looking at the name. A path pointing at whichever of
 *    three cross-linked entries happened to be first would therefore make the next import
 *    propose an update to the wrong entity, which is the false merge §6.4 weights heaviest.
 *    At size 1 the row is exactly the one an accepted update from this document would have
 *    written, and issue #178 already writes that shape for a folded document.
 *
 * A document with no sighting at all (`job_finish` with outcome `skipped` - an empty note,
 * a template) never reaches this function, because `handleEvent` only calls it when the
 * document buffered something. That case leaks the same way and cannot be fixed here:
 * `entity_source_ref.entity_id` is `NOT NULL`, the table has no `universe_id` of its own
 * (every read scopes through the entity join), and there is no entity to point at. It needs
 * a document-level row, which is a migration, and it is written up on issue #573 rather
 * than guessed at here.
 */
function declinedDocumentEarnsSourceRef(
	documentStatus: DocumentStatus,
	declined: DeclineLedger
): boolean {
	return (
		documentStatus === 'finished' &&
		declined.withoutEntity === 0 &&
		declined.folded === 0 &&
		declined.relationDrops.total === 0 &&
		declined.vocabularyProposals === 0 &&
		declined.ontoEntityIds.size === 1
	);
}

/**
 * SPEC.md §6.1's "match against what already exists, merge, resolve conflicts - a
 * deterministic engine, this is where damage would happen, so no model decides it." Runs
 * `resolveMatch` (matching.ts) for every entity this document proposed, turns the
 * decision into a real `proposal` row (never a silent write to canon - guardrail 1's only
 * exception is a genuinely unchanged field, handled upstream by the content-hash
 * short-circuit before this function is ever called), then does the same for relations
 * whose endpoints both resolved to real, already-existing entities.
 *
 * The one row this writes without a proposal behind it is provenance rather than canon:
 * issue #573's `entity_source_ref` for a document the engine deliberately produced nothing
 * for. `declinedDocumentEarnsSourceRef` carries that argument and the conditions.
 *
 * issue #126: every patch carries `language`, straight from `payload.language` (the
 * per-document detection `GatewayDriver` already ran - see `EntityProposalPayload`'s own
 * comment). This package stops at proposing it; the accept-time write of
 * `entity.language` from a patch is issue #122's own boundary (packages/db), not
 * duplicated here - `patch` is `unknown` all the way down this file on purpose, exactly
 * so a field like this can travel through a proposal without this module having to know
 * what reads it on the other end.
 */
async function materializeDocumentProposals(
	params: RunImportJobParams,
	documentId: string,
	buffer: DocumentBuffer,
	contentHash: string,
	/** This document's terminal status (issue #573). Only `'finished'` is the model
	 * asserting it had nothing more to say; `'stopped_at_ceiling'` is the other status
	 * that reaches here, and a document cut off mid-run must never earn the source ref
	 * `declinedDocumentEarnsSourceRef` writes. */
	documentStatus: DocumentStatus
): Promise<MaterializeResult> {
	const { db } = params;
	const locale: Locale = params.locale ?? 'en';
	const localIdToEntityId = new Map<string, string>();
	// issue #613: the local ids whose entry this job is only *proposing*, and which of the
	// two proposal shapes that is (`RelationEndpoint`'s own comment has both). A local id in
	// neither this map nor `localIdToEntityId` has no entry behind it at all: the engine
	// declined that sighting, or the model named it in a relation without ever proposing an
	// entity for it, and a relation naming it is the one loss that stays a loss.
	const localIdToCandidate = new Map<string, RelationEndpoint>();
	const localIdToType = new Map<string, EntityProposalPayload['type']>();
	const resolved: ResolvedEntityCandidate[] = [];
	const declined = newDeclineLedger();
	// issue #627: sightings in this document whose candidate pool came back capped, so the
	// merge decision that followed was taken against a partial view of the universe or of
	// the job. Reported rather than acted on: SPEC.md §6.4 weights a false merge far above a
	// false split, and a truncated pool can only cause the cheap error, but a fold rate
	// measured over truncated pools is a different number from one measured over complete
	// pools and the benchmark has no way to tell them apart unless the run says so.
	let truncatedPools = 0;
	const sourceTexts = await readSourceTextsForContext(params, buffer);

	// The identity pool (issue #479), built once for the document rather than per entity:
	// everything the universe already carries under a slug or a name this document is about
	// to propose, plus this job's own still-pending creates that claim one, both type-blind
	// because `entity_universe_slug_key` is unique per universe and not per type. This is the
	// step SPEC.md §6.4's order was missing between the external id and the embeddings:
	// #479's Cairnmouth reached the scorer with the right candidate in its pool and came back
	// `new` anyway, at cosine 0.5446 under a `newBelow` of 0.60, because an identical name
	// is one line of four in the text `matchTextFor` embeds.
	//
	// Both halves are keyed by the identity asked about (issue #627). The pending half used
	// to be a capped page of the job's pending creates filtered here, which on a job with
	// more than 200 of them silently answered "no collision" for every create outside the
	// page: #479's defect back again, on exactly the size of import this pool exists for.
	//
	// Aliases go into the *names* asked for but never into the identity comparison: they
	// are here so `pruneForeignAliases` can see that an alias is somebody else's title,
	// which is #479's third defect and would become a false merge if it counted as
	// identity.
	const proposedEntities = [...buffer.entities.values()];
	const identitySlugs = proposedEntities.map((payload) => slugify(payload.name));
	const identityNames = proposedEntities.flatMap((payload) => [payload.name, ...payload.aliases]);
	const [existingIdentities, pendingIdentities] = await Promise.all([
		entitiesByIdentity(db, params.universeId, identitySlugs, identityNames),
		pendingEntityProposalsByIdentity(db, params.dbJobId, identitySlugs, identityNames)
	]);
	const identityCandidates: IdentityCandidate[] = [
		...existingIdentities,
		...pendingIdentities.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			type: row.type as string
		}))
	];
	const identityProposalIds = new Set(pendingIdentities.map((row) => row.id));
	// Every name this document put on the table, the entity's own and its neighbours'.
	// `isBareMention` subtracts these before asking whether anything is left
	// that the source actually says: "the marsh road" in #479's Cairnmouth body is another
	// entry's title, not a fact about the town.
	const documentNames = proposedEntities.flatMap((payload) => [payload.name, ...payload.aliases]);

	for (const [localId, payload] of buffer.entities) {
		localIdToType.set(localId, payload.type);
		const exact = await findEntityBySourceRef(
			db,
			params.universeId,
			params.sourceSystem,
			payload.sourceRef.path
		);
		const [candidatePool, pendingPool]: [MatchCandidatePool, MatchCandidatePool] = exact
			? [EMPTY_POOL, EMPTY_POOL]
			: await Promise.all([
					candidateEntitiesForMatching(db, params.universeId, payload.type),
					pendingEntityProposalsForJob(db, params.dbJobId, payload.type)
				]);
		if (candidatePool.truncated || pendingPool.truncated) truncatedPools += 1;
		// Every candidate id in play that is a pending proposal rather than an entity, so a
		// `match` or `identity` decision naming one folds instead of being read as an entity
		// id. Both pools contribute: the identity half is type-blind on purpose (issue #479 -
		// a collision can land on a pending create of a *different* type and still has to
		// fold), and the semantic half is this type's, which the identity half no longer
		// contains now that it is keyed by identity rather than being every pending create.
		const pendingProposalIds = new Set(identityProposalIds);
		for (const row of pendingPool.candidates) pendingProposalIds.add(row.id);

		const decision = await resolveMatch({
			subject: {
				name: payload.name,
				aliases: payload.aliases,
				context: {
					type: payload.type,
					summary: oneLineSummary(payload.summary),
					sourceSentence: oneLineSummary(
						spanText(sourceTexts.get(payload.sourceRef.path), payload.evidenceSpan)
					)
				}
			},
			exactSourceRefMatch: exact
				? { id: exact.entityId, name: exact.name, aliases: exact.aliases }
				: null,
			// Omitted rather than passed as undefined when an external id already decided it:
			// `exactSourceRefMatch` short-circuits first anyway, and the free identity lookup
			// has nothing to add to a decision SPEC.md §6.4 already calls step 1.
			...(exact
				? {}
				: {
						identity: {
							subject: { name: payload.name, slug: slugify(payload.name) },
							candidates: identityCandidates
						}
					}),
			candidates: [...candidatePool.candidates, ...pendingPool.candidates].map(toMatchCandidate),
			similarity: params.similarity,
			thresholds: params.thresholds
		});

		if (
			decision.outcome === 'exact' ||
			decision.outcome === 'match' ||
			decision.outcome === 'identity'
		) {
			if (decision.outcome !== 'exact' && pendingProposalIds.has(decision.candidateId)) {
				// SPEC.md §6.4's order extended to the job's own output (issue #160): this
				// document's sighting matches a `create` proposal an earlier document in
				// this same job already wrote, still pending. It folds into that proposal -
				// never a second create, and never an `update` either, since the entity
				// behind a pending create does not exist yet for one to target. Nothing
				// lands in `resolved` and `localIdToEntityId` stays unset for this local id,
				// exactly like a brand-new entity: a relation naming it in this same
				// document has nothing real to point at yet either.
				//
				// issue #178: this document's own sourceRef/contentHash travels with the
				// fold (not just its names) so the eventual accept can still give *this*
				// document an `entity_source_ref` row of its own - the surviving proposal's
				// `evidence.sourceRef` stays the first document's forever, which used to mean
				// every document after the first was invisible to the next import's skip
				// check and got re-processed on every run.
				await foldEntitySightingIntoPendingProposal(db, {
					proposalId: decision.candidateId,
					names: [payload.name, ...payload.aliases],
					documentId,
					sourceRef: payload.sourceRef,
					contentHash
				});
				// issue #613: the surviving proposal is what a relation naming this local id
				// has to wait for, so this sighting is 'proposed' rather than nothing.
				localIdToCandidate.set(localId, { kind: 'proposal', proposalId: decision.candidateId });
				declined.folded += 1;
				continue;
			}
			// Guardrail 3 as a precondition rather than a decoration (issue #479): a payload
			// whose body shares not one content word with the document it claims to come from
			// has no evidence to show, so there is no proposal to make. #479's Cairnmouth was
			// never described in the vault at all - it appeared as a `[[Cairnmouth]]` link in
			// two other notes and the model wrote "A place mentioned in relation to the marsh
			// road", a sentence about the import. The resolution still stands, and that
			// matters: `localIdToEntityId` is set, so a relation this document really does
			// support ("warden of the marsh road east of Cairnmouth") still points at the
			// right entity. What is dropped is the entity-content proposal, not the sighting.
			localIdToEntityId.set(localId, decision.candidateId);
			if (
				isBareMention({
					name: payload.name,
					body: payload.summary,
					sourceText: sourceTexts.get(payload.sourceRef.path),
					documentNames
				})
			) {
				declined.ontoEntityIds.add(decision.candidateId);
				continue;
			}

			const target = (await entityUpdateTargetsByIds(db, [decision.candidateId])).get(
				decision.candidateId
			);
			const bodyVerdict = bodyWriteVerdict(target?.body ?? '', payload.summary);
			const aliases = pruneForeignAliases(
				payload.name,
				payload.aliases,
				foreignNamesFor(payload, proposedEntities, identityCandidates, decision.candidateId)
			);
			// SPEC.md §6.4's "field edited by the user, unchanged at the source: leave it
			// alone", read at the level of the whole proposal (issue #479). Once a refused
			// body write has taken `after` out, an update that repeats the entity's own name
			// and no new alias costs the GM a decision and changes nothing.
			if (
				updatePatchAddsNothing({
					currentName: target?.name ?? payload.name,
					currentAliases: target?.aliases ?? [],
					proposedName: payload.name,
					proposedAliases: aliases,
					writesBody: !bodyVerdict.loses
				})
			) {
				declined.ontoEntityIds.add(decision.candidateId);
				continue;
			}
			resolved.push({
				localId,
				candidate: {
					kind: 'update',
					targetEntityId: decision.candidateId,
					rationale: IMPORT_RATIONALE_MATCHED[locale](payload.sourceRef.path),
					evidence: matchEvidence(
						documentId,
						payload,
						decision.outcome === 'match' ? decision.similarity : null,
						[],
						contentHash
					),
					rank: resolved.length
				},
				patch: {
					name: payload.name,
					aliases,
					// A refused body write drops `after` from the patch rather than softening
					// it: `acceptProposal` writes `body: patch.after ?? current.body`, so an
					// absent `after` is exactly "leave the body alone" and needs no new
					// vocabulary on the accept side.
					...(bodyVerdict.loses ? {} : { after: payload.summary }),
					language: payload.language
				}
			});
		} else {
			// Same guardrail 3 precondition as the update branch, and the reason it has to be
			// on both: #479's Cairnmouth only became an update once the identity guard above
			// existed. In a universe that does not already carry the name, the identical bad
			// extraction is a `create` whose whole body is a sentence about the import.
			if (
				isBareMention({
					name: payload.name,
					body: payload.summary,
					sourceText: sourceTexts.get(payload.sourceRef.path),
					documentNames
				})
			) {
				declined.withoutEntity += 1;
				continue;
			}
			const ambiguousCandidateIds = decision.outcome === 'ask' ? decision.candidateIds : [];
			// issue #613: this document is proposing the entity, so a relation naming it is
			// waiting on an accept rather than on nothing.
			localIdToCandidate.set(localId, { kind: 'candidate', index: resolved.length });
			resolved.push({
				localId,
				candidate: {
					kind: 'create',
					targetEntityId: null,
					rationale:
						decision.outcome === 'ask'
							? IMPORT_RATIONALE_AMBIGUOUS[locale](
									payload.sourceRef.path,
									ambiguousCandidateIds.length
								)
							: IMPORT_RATIONALE_EXTRACTED[locale](payload.sourceRef.path),
					evidence: matchEvidence(
						documentId,
						payload,
						decision.outcome === 'ask' ? decision.similarity : null,
						ambiguousCandidateIds,
						contentHash
					),
					rank: resolved.length
				},
				patch: {
					type: payload.type,
					name: payload.name,
					slug: slugify(payload.name),
					aliases: pruneForeignAliases(
						payload.name,
						payload.aliases,
						foreignNamesFor(payload, proposedEntities, identityCandidates, null)
					),
					body: payload.summary,
					language: payload.language
				}
			});
		}
	}

	const relationCandidates: Array<{ candidate: CreateProposalPlanCandidate; patch: unknown }> = [];
	// Decision K1's own queue, drained after the plan exists rather than inside this loop:
	// see `vocabularyWaiting`'s type above for why the two cannot happen in one pass.
	const vocabularyWaiting: VocabularyWaitingRelation[] = [];
	for (const relationPayload of buffer.relations) {
		const from = endpointFor(relationPayload.fromLocalId, localIdToEntityId, localIdToCandidate);
		const to = endpointFor(relationPayload.toLocalId, localIdToEntityId, localIdToCandidate);
		const fromType = localIdToType.get(relationPayload.fromLocalId);
		const toType = localIdToType.get(relationPayload.toLocalId);
		// The one loss issue #613 does not recover, and the only one left: an endpoint the
		// engine declined outright (a bare mention, issue #479) or a local id the model named
		// in a relation without ever proposing an entity for it. There is no proposal to wait
		// for, so no accept order reaches this relation and a later import is the only way
		// back - which is why issue #573 still counts it as a reason to re-read the document.
		if (!from || !to || !fromType || !toType) {
			declined.relationDrops.total += 1;
			declined.relationDrops.noEndProposed += 1;
			continue;
		}
		// Two local ids in *this* document can also resolve onto the same target (issue
		// #160), whether that target is an entity or one of this job's own pending
		// proposals: the relation between them would be a self-loop, which
		// `relation_from_ne_to` refuses at accept time anyway. Never propose one - there
		// is nothing a GM could usefully accept about an entity relating to itself.
		if (sameEndpoint(from, to)) {
			declined.relationDrops.total += 1;
			declined.relationDrops.selfLoop += 1;
			continue;
		}

		const resolution = await resolveRelationType(
			{ db, embed: params.embedRelationLabel },
			{
				universeId: params.universeId,
				label: relationPayload.label,
				inverseLabel: relationPayload.inverseLabel,
				cardinality: relationPayload.cardinality,
				fromType,
				toType
			}
		);

		const rationale = IMPORT_RATIONALE_RELATION[locale](relationPayload.sourceRef.path);
		const evidence = {
			documentId,
			sourceRef: relationPayload.sourceRef,
			evidenceSpan: relationPayload.evidenceSpan
		};

		if (resolution.kind === 'existing') {
			// Issue #613: whichever of the two ends is still a proposal travels as a proposal
			// reference rather than stopping the relation here. The row this writes is a
			// pending `relation` proposal either way, shown with its own evidence and
			// accepted on its own; the only difference is that an unresolved end refuses the
			// accept until the entry at that end is accepted first.
			if (from.kind !== 'entity' || to.kind !== 'entity') declined.relationDrops.deferred += 1;
			relationCandidates.push({
				candidate: {
					kind: 'relation',
					targetEntityId: from.kind === 'entity' ? from.entityId : null,
					relationTypeId: resolution.type.id,
					relatedEntityId: to.kind === 'entity' ? to.entityId : null,
					...endpointRefs('target', from),
					...endpointRefs('related', to),
					rationale,
					evidence,
					rank: resolved.length + relationCandidates.length
				},
				patch: {}
			});
			continue;
		}

		// Decision K1, issue #190: reuse-proposed/widen-proposed/new-proposed never write
		// a relation_type row or a relation row from here - each becomes (or folds into)
		// one vocabulary proposal this job's own review queue shows, and only a GM's
		// accept on that proposal unblocks this relation into its own pending `relation`
		// proposal. See proposeRelationTypeVocabulary's own comment for the fold shape.
		//
		// Issue #613 moved the write out of this loop: an endpoint that is a `create` in
		// this document's own plan has no id until `createProposalPlan` below has run, and a
		// vocabulary patch is jsonb that outlives this function, so it cannot carry an index
		// into an array that no longer exists. Queued here, written once the ids are real.
		vocabularyWaiting.push({
			resolution: toVocabResolutionInput(resolution),
			from,
			to,
			rationale,
			evidence
		});
		declined.vocabularyProposals += 1;
	}

	const allCandidates = [
		...resolved.map((r) => r.candidate),
		...relationCandidates.map((r) => r.candidate)
	];
	if (allCandidates.length === 0) {
		// No candidates means no `candidate`-kind endpoint can exist either (there is nothing
		// for an index to point at), so the vocabulary queue is safe to drain with no plan.
		await writeVocabularyProposals(params, vocabularyWaiting, []);
		// `run()`'s skip looks a ref up by `JobDocument.sourcePath`, so that is the key this
		// has to write, not the path off a payload's `sourceRef`. They are the same string
		// today (tools.ts stamps it from the document context and the model cannot pass one),
		// and reading it from the job's own document list is what keeps them the same string
		// if that ever stops being true. No path, no key the skip could ever match, so no row.
		const sourcePath = params.documents.find((doc) => doc.id === documentId)?.sourcePath;
		const [entityId] = [...declined.ontoEntityIds];
		if (sourcePath && entityId && declinedDocumentEarnsSourceRef(documentStatus, declined)) {
			await recordEntitySourceRef(db, {
				entityId,
				sourceSystem: params.sourceSystem,
				externalId: sourcePath,
				sourceUrl: null,
				contentHash,
				lastImportJobId: params.dbJobId
			});
		}
		return { proposalsCreated: 0, relationDrops: declined.relationDrops, truncatedPools };
	}

	const { proposals } = await createProposalPlan(db, {
		universeId: params.universeId,
		trigger: 'import',
		importJobId: params.dbJobId,
		summary: `Import: ${resolved.length} entit${resolved.length === 1 ? 'y' : 'ies'}, ${relationCandidates.length} relation(s) from document "${documentId}".`,
		candidateCap: allCandidates.length,
		estimatedCredits: 0,
		candidates: allCandidates,
		locale
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

	// Decision K1's queue, now that every `create` in this plan has an id a jsonb patch can
	// hold onto (issue #613).
	await writeVocabularyProposals(params, vocabularyWaiting, proposals);

	return {
		proposalsCreated: proposals.length,
		relationDrops: declined.relationDrops,
		truncatedPools
	};
}

function isEmptyPatchTarget(patch: unknown): boolean {
	return typeof patch === 'object' && patch !== null && Object.keys(patch).length === 0;
}

/** `contentHash` is the hash of the raw source document `run()` already computed to
 * decide whether to skip this document - carried into the evidence blob (rather than,
 * say, a new proposal_plan column) because it is per-*entity-proposal* provenance, the
 * same shape `sourceRef`/`evidenceSpan` already are, and the review UI's accept action
 * (`acceptImportProposal`) needs it to record `entity_source_ref` without a `SourceReader`
 * of its own. `foldedSources` starts empty: it only grows past this call, on a `create`/
 * `draft_entity` proposal, if a later document's own sighting folds into this one
 * (`foldEntitySightingIntoPendingProposal`, issue #178) - never here, since this document
 * has not folded into anything, it *is* the sighting a later one might fold into. */
function matchEvidence(
	documentId: string,
	payload: EntityProposalPayload,
	similarity: number | null,
	ambiguousCandidateIds: string[],
	contentHash: string
): unknown {
	return {
		documentId,
		sourceRef: payload.sourceRef,
		evidenceSpan: payload.evidenceSpan,
		similarity,
		ambiguousCandidateIds,
		contentHash,
		foldedSources: []
	};
}

// ---------------------------------------------------------------------------
// Accept + source-ref bookkeeping, re-exported for review flows (issue #36): the review
// UI's accept action should call this rather than @canonry/db's bare acceptImportProposal
// so entity_source_ref always lands with the same call that writes the entity.
// acceptAnyImportProposal (issue #190) dispatches by kind first - a relation-type
// vocabulary proposal never touches entity_source_ref, an entity/relation one always
// goes through acceptImportProposal exactly as before - so a review flow only ever has
// to call the one function regardless of what kind the job happened to produce.
// ---------------------------------------------------------------------------

export type { AcceptImportProposalInput };
export const acceptImportProposal = dbAcceptImportProposal;
export const acceptAnyImportProposal = dbAcceptAnyImportProposal;
export { isRelationTypeProposalKind };
