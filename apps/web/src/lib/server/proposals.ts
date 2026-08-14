/**
 * The read (and thin write-orchestration) seam between `@canonry/db`'s proposal tables
 * and the review surfaces: the inbox (C2 = A), the plan/queue screen (C3, C4, C5, C6,
 * #51), the import review screen (D4, #42), and the entry page's AI marking (C1, #106).
 *
 * Every write in here delegates straight to `@canonry/db`'s `acceptProposal` /
 * `rejectProposal` / `dropCandidateFromPlan` / `setProposalPlanStatus` - guardrail 1's
 * "nothing else writes canon from a proposal" holds for this file too. What lives here is
 * composing reads across tables `@canonry/db`'s own query modules do not join (a plan's
 * candidates with their target entities, an import job's proposals across every document
 * plan it produced, one entity's pending proposals for the marking), because none of that
 * is packages/db/schema or packages/db/migrations territory - it is application-shaped
 * read composition over already-exported tables and operators.
 */
import {
	and,
	desc,
	eq,
	inArray,
	sql,
	acceptProposal,
	rejectProposal,
	undoAcceptedProposal,
	setRejectReason,
	dropCandidateFromPlan,
	setProposalPlanStatus,
	listProposalsForPlan,
	getProposalPlan,
	getProposal,
	ProposalNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalCannotBeAcceptedError,
	ProposalNotAcceptedError,
	ProposalHasDiffError,
	UndoNotPossibleError,
	type Db,
	type ProposalRow,
	type ProposalPlanRow,
	type ImportJobRow,
	type AcceptProposalInput,
	type RejectProposalInput
} from '@canonry/db';
import {
	entity,
	importJob,
	proposal,
	proposalPlan,
	relationType,
	type EntityType,
	type ProposalKind
} from '@canonry/db/schema';
import { semanticDiff, type FactChange } from '@canonry/copilot';
import { normalizeEvidence, type EvidenceView } from '$lib/components/proposals/evidence';
import { diffLayoutFor, type DiffLayout } from '$lib/components/proposals/diffLayout';

export {
	acceptProposal,
	rejectProposal,
	undoAcceptedProposal,
	setRejectReason,
	dropCandidateFromPlan,
	setProposalPlanStatus,
	listProposalsForPlan,
	getProposalPlan,
	getProposal,
	ProposalNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalCannotBeAcceptedError,
	ProposalNotAcceptedError,
	ProposalHasDiffError,
	UndoNotPossibleError,
	type ProposalRow,
	type ProposalPlanRow,
	type AcceptProposalInput,
	type RejectProposalInput
};

// ---------------------------------------------------------------------------
// Inbox (C2 = A): propagation plans and import jobs that still carry a pending proposal.
// ---------------------------------------------------------------------------

export interface InboxPropagationPlan {
	plan: ProposalPlanRow;
	triggerEntityName: string | null;
	pending: number;
	accepted: number;
	rejected: number;
	total: number;
}

const PENDING_COUNT = sql<number>`count(*) filter (where ${proposal.outcome} = 'pending')`.mapWith(
	Number
);
const ACCEPTED_COUNT =
	sql<number>`count(*) filter (where ${proposal.outcome} = 'accepted')`.mapWith(Number);
const REJECTED_COUNT =
	sql<number>`count(*) filter (where ${proposal.outcome} = 'rejected')`.mapWith(Number);
const TOTAL_COUNT = sql<number>`count(*)`.mapWith(Number);

/** Propagation-triggered plans (everything except `trigger = 'import'`, which the import
 * job summary below owns) with at least one undecided proposal, newest first. */
export async function propagationPlansForInbox(
	db: Db,
	universeId: string
): Promise<InboxPropagationPlan[]> {
	const rows = await db
		.select({
			plan: proposalPlan,
			pending: PENDING_COUNT,
			accepted: ACCEPTED_COUNT,
			rejected: REJECTED_COUNT,
			total: TOTAL_COUNT
		})
		.from(proposalPlan)
		.innerJoin(proposal, eq(proposal.planId, proposalPlan.id))
		.where(and(eq(proposalPlan.universeId, universeId), sql`${proposalPlan.trigger} <> 'import'`))
		.groupBy(proposalPlan.id)
		.having(sql`count(*) filter (where ${proposal.outcome} = 'pending') > 0`)
		.orderBy(desc(proposalPlan.createdAt));

	const entityIds = [
		...new Set(rows.map((r) => r.plan.triggerEntityId).filter((id) => id !== null))
	];
	const names = entityIds.length
		? await db
				.select({ id: entity.id, name: entity.name })
				.from(entity)
				.where(inArray(entity.id, entityIds))
		: [];
	const nameById = new Map(names.map((n) => [n.id, n.name]));

	return rows.map((r) => ({
		...r,
		triggerEntityName: r.plan.triggerEntityId
			? (nameById.get(r.plan.triggerEntityId) ?? null)
			: null
	}));
}

export interface InboxImportJob {
	job: ImportJobRow;
	pending: number;
	accepted: number;
	rejected: number;
	total: number;
}

/** Import jobs (any status) that still have at least one undecided proposal across the
 * per-document plans `packages/import`'s job-runner created for them, newest first. */
export async function importJobsForInbox(db: Db, universeId: string): Promise<InboxImportJob[]> {
	return db
		.select({
			job: importJob,
			pending: PENDING_COUNT,
			accepted: ACCEPTED_COUNT,
			rejected: REJECTED_COUNT,
			total: TOTAL_COUNT
		})
		.from(importJob)
		.innerJoin(proposalPlan, eq(proposalPlan.importJobId, importJob.id))
		.innerJoin(proposal, eq(proposal.planId, proposalPlan.id))
		.where(eq(importJob.universeId, universeId))
		.groupBy(importJob.id)
		.having(sql`count(*) filter (where ${proposal.outcome} = 'pending') > 0`)
		.orderBy(desc(importJob.createdAt));
}

/** Total pending proposals for a universe, across every plan - the sidebar nav badge
 * (nav.ts's `proposals` item). */
export async function pendingProposalCount(db: Db, universeId: string): Promise<number> {
	const [row] = await db
		.select({ n: TOTAL_COUNT })
		.from(proposal)
		.where(and(eq(proposal.universeId, universeId), eq(proposal.outcome, 'pending')));
	return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// One candidate, resolved with enough entity/relation context to render a diff card.
// ---------------------------------------------------------------------------

export interface EntitySummary {
	id: string;
	name: string;
	slug: string;
	type: EntityType;
	body: string;
	aliases: string[];
}

export interface RelationTypeSummary {
	id: string;
	label: string;
	inverseLabel: string;
}

export interface ProposalCandidate {
	proposal: ProposalRow;
	/** The entry this candidate updates, or the relation's "from" side. Null for a
	 * `create`/`draft_entity` proposal, which has no target yet. */
	targetEntity: EntitySummary | null;
	/** The relation's "to" side. Null unless `proposal.kind === 'relation'`. */
	relatedEntity: EntitySummary | null;
	relationType: RelationTypeSummary | null;
	/** Derived entry type for D4's filter chips: the target's real type for `update`, the
	 * patch's declared type for `create`/`draft_entity`, `'relation'` for a relation. */
	filterType: EntityType | 'relation';
}

function summarize(row: typeof entity.$inferSelect): EntitySummary {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		type: row.type,
		body: row.body,
		aliases: row.aliases
	};
}

function patchType(patch: unknown): EntityType | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const value = (patch as Record<string, unknown>).type;
	return typeof value === 'string' ? (value as EntityType) : null;
}

/** Resolves a flat list of proposal rows into display-ready candidates in one pass: every
 * entity id any of them reference (target or related) is fetched in a single batched
 * query, and every relation type the same way, rather than one query per row. */
export async function resolveCandidates(db: Db, rows: ProposalRow[]): Promise<ProposalCandidate[]> {
	const entityIds = new Set<string>();
	const relationTypeIds = new Set<string>();
	for (const row of rows) {
		if (row.targetEntityId) entityIds.add(row.targetEntityId);
		if (row.relatedEntityId) entityIds.add(row.relatedEntityId);
		if (row.relationTypeId) relationTypeIds.add(row.relationTypeId);
	}

	const entityRows = entityIds.size
		? await db
				.select()
				.from(entity)
				.where(inArray(entity.id, [...entityIds]))
		: [];
	const entityById = new Map(entityRows.map((row) => [row.id, row]));

	const relationTypeRows = relationTypeIds.size
		? await db
				.select()
				.from(relationType)
				.where(inArray(relationType.id, [...relationTypeIds]))
		: [];
	const relationTypeById = new Map(relationTypeRows.map((row) => [row.id, row]));

	return rows.map((row) => {
		const targetRow = row.targetEntityId ? entityById.get(row.targetEntityId) : undefined;
		const relatedRow = row.relatedEntityId ? entityById.get(row.relatedEntityId) : undefined;
		const relTypeRow = row.relationTypeId ? relationTypeById.get(row.relationTypeId) : undefined;
		const targetEntity = targetRow ? summarize(targetRow) : null;
		const relatedEntity = relatedRow ? summarize(relatedRow) : null;
		const relationTypeSummary = relTypeRow
			? { id: relTypeRow.id, label: relTypeRow.label, inverseLabel: relTypeRow.inverseLabel }
			: null;

		const filterType: EntityType | 'relation' =
			row.kind === 'relation'
				? 'relation'
				: (targetEntity?.type ?? patchType(row.patch) ?? 'character');

		return {
			proposal: row,
			targetEntity,
			relatedEntity,
			relationType: relationTypeSummary,
			filterType
		};
	});
}

// ---------------------------------------------------------------------------
// #51: one candidate enriched for the diff card - the semantic diff (C4), which layout
// it gets (C4's sentence-count threshold) and its normalised evidence (C5), computed once
// server-side so the client component only ever renders already-resolved data.
// ---------------------------------------------------------------------------

function readPatchBefore(patch: unknown): string | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const value = (patch as Record<string, unknown>).before;
	return typeof value === 'string' ? value : null;
}

export interface DiffCandidate {
	id: string;
	planId: string | null;
	kind: ProposalKind;
	outcome: string;
	rank: number;
	rationale: string;
	rejectReason: string | null;
	credits: number;
	targetName: string | null;
	targetType: EntityType | null;
	targetSlug: string | null;
	relatedName: string | null;
	relationLabel: string | null;
	diff: FactChange[];
	diffLayout: DiffLayout;
	evidenceViews: EvidenceView[];
	evidenceForceOpen: boolean;
}

/** Turns one resolved candidate into everything `ProposalDiffCard` needs to render,
 * without the component ever having to know a propagation patch's shape differs from an
 * import patch's. `before` falls back to the target entity's live body when the patch
 * itself carries none (import's `update` patches never set `before` - see
 * `job-runner.ts`'s `materializeDocumentProposals`), so a diff always reads against real
 * current content, exactly like `changedSentencesForEntity` above. */
export function enrichCandidate(candidate: ProposalCandidate): DiffCandidate {
	const p = candidate.proposal;
	let diff: FactChange[] = [];
	if (p.kind === 'update' || p.kind === 'create' || p.kind === 'draft_entity') {
		const after = readPatchAfter(p.patch) ?? '';
		const before =
			p.kind === 'update' ? (readPatchBefore(p.patch) ?? candidate.targetEntity?.body ?? '') : '';
		if (before || after) diff = semanticDiff(before, after);
	}
	const { views, forceOpen } = normalizeEvidence(p.trigger, p.evidence);

	return {
		id: p.id,
		planId: p.planId,
		kind: p.kind,
		outcome: p.outcome,
		rank: p.rank,
		rationale: p.rationale,
		rejectReason: p.rejectReason,
		credits: p.credits,
		targetName: candidate.targetEntity?.name ?? null,
		targetType: candidate.targetEntity?.type ?? null,
		targetSlug: candidate.targetEntity?.slug ?? null,
		relatedName: candidate.relatedEntity?.name ?? null,
		relationLabel: candidate.relationType?.label ?? null,
		diff,
		diffLayout: diffLayoutFor(diff),
		evidenceViews: views,
		evidenceForceOpen: forceOpen
	};
}

export function enrichCandidates(candidates: ProposalCandidate[]): DiffCandidate[] {
	return candidates.map(enrichCandidate);
}

// ---------------------------------------------------------------------------
// Plan detail (#51: the C3 checklist, then the C4/C5/C6 queue once diffs exist).
// ---------------------------------------------------------------------------

export interface PlanDetail {
	plan: ProposalPlanRow;
	triggerEntityName: string | null;
	candidates: ProposalCandidate[];
}

export async function planDetailFor(
	db: Db,
	universeId: string,
	planId: string
): Promise<PlanDetail | null> {
	const plan = await getProposalPlan(db, planId);
	if (!plan || plan.universeId !== universeId) return null;

	const rows = await listProposalsForPlan(db, planId);
	const candidates = await resolveCandidates(db, rows);

	let triggerEntityName: string | null = null;
	if (plan.triggerEntityId) {
		const [row] = await db
			.select({ name: entity.name })
			.from(entity)
			.where(eq(entity.id, plan.triggerEntityId))
			.limit(1);
		triggerEntityName = row?.name ?? null;
	}

	return { plan, triggerEntityName, candidates };
}

// ---------------------------------------------------------------------------
// Import job detail (#42, D4): every proposal across every per-document plan the job
// produced, joined on proposal_plan.import_job_id.
// ---------------------------------------------------------------------------

export interface ImportJobDetail {
	job: ImportJobRow;
	candidates: ProposalCandidate[];
}

export async function importJobDetailFor(
	db: Db,
	universeId: string,
	jobId: string
): Promise<ImportJobDetail | null> {
	const [job] = await db.select().from(importJob).where(eq(importJob.id, jobId)).limit(1);
	if (!job || job.universeId !== universeId) return null;

	const rows = await db
		.select({ proposal })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(eq(proposalPlan.importJobId, jobId))
		.orderBy(proposal.createdAt);

	const candidates = await resolveCandidates(
		db,
		rows.map((r) => r.proposal)
	);
	return { job, candidates };
}

// ---------------------------------------------------------------------------
// #106: an entity's own pending `update` proposals, for the C1 = B marking on the entry
// read view. A `create`/`draft_entity`/`relation` proposal has nothing to mark on an
// entry that does not exist yet (or is not this entry), so only `update` is read here.
// ---------------------------------------------------------------------------

export interface PendingEntityProposal {
	id: string;
	planId: string | null;
	kind: ProposalKind;
	patch: unknown;
}

export async function pendingUpdateProposalsForEntity(
	db: Db,
	universeId: string,
	entityId: string
): Promise<PendingEntityProposal[]> {
	return db
		.select({
			id: proposal.id,
			planId: proposal.planId,
			kind: proposal.kind,
			patch: proposal.patch
		})
		.from(proposal)
		.where(
			and(
				eq(proposal.universeId, universeId),
				eq(proposal.targetEntityId, entityId),
				eq(proposal.kind, 'update'),
				eq(proposal.outcome, 'pending')
			)
		)
		.orderBy(desc(proposal.createdAt));
}

// ---------------------------------------------------------------------------
// #106: the changed-sentence set the entry page's marking needs, derived from a live
// re-diff against the entity's current body rather than the proposal's stored `before`
// snapshot - the entry always marks what a proposal would actually change *now*, which
// matters if the entity moved on since the diff was written (the proposal is then
// candidate for `superseded`, not this file's concern, but the marking should never lag).
// ---------------------------------------------------------------------------

function readPatchAfter(patch: unknown): string | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const value = (patch as Record<string, unknown>).after;
	return typeof value === 'string' ? value : null;
}

/** Every sentence, in `currentBody`, that at least one of `proposals` would replace or
 * remove - the C1 = B marking's input. An 'added' sentence has nothing in the current body
 * to underline, so only 'changed' (the replaced half) and 'removed' contribute. */
export function changedSentencesForEntity(
	currentBody: string,
	proposals: PendingEntityProposal[]
): Set<string> {
	const changed = new Set<string>();
	for (const candidate of proposals) {
		const after = readPatchAfter(candidate.patch);
		if (after === null) continue;
		for (const change of semanticDiff(currentBody, after)) {
			if (change.kind === 'changed' && change.previousStatement) {
				changed.add(change.previousStatement);
			} else if (change.kind === 'removed') {
				changed.add(change.statement);
			}
		}
	}
	return changed;
}
