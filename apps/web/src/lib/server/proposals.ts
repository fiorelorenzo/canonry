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
	undoAcceptedProposal as undoAcceptedProposalRow,
	entityDeletedByUndo,
	setRejectReason,
	dropCandidateFromPlan,
	setProposalPlanStatus,
	listProposalsForPlan,
	getProposalPlan,
	getProposal,
	isRelationTypeProposalKind,
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
	type RejectProposalInput,
	type UndoAcceptedProposalInput,
	type RelationTypeVocabPatch
} from '@canonry/db';
import {
	entity,
	importJob,
	proposal,
	proposalPlan,
	relationType,
	type EntityType,
	type ProposalKind,
	type RelationCardinality
} from '@canonry/db/schema';
import { ModelNotConfiguredError, resolveModel } from '@canonry/ai';
import { acceptAnyImportProposal, type AcceptImportProposalInput } from '@canonry/import';
import { semanticDiff } from '@canonry/copilot';
import { deleteEntityLoreChunks, resolveOwnCanonCollection } from '@canonry/indexing';
import { vectorClient } from '$lib/server/copilot';
import {
	normalizeEvidence,
	type EvidenceCaveat,
	type EvidenceView
} from '$lib/components/proposals/evidence';
import { proseDiff, EMPTY_PROSE_DIFF, type ProseDiff } from '$lib/components/proposals/proseDiff';

export {
	acceptProposal,
	rejectProposal,
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

/** Issue #164: an entity delete has to remove its own-canon lore points too, or a stale
 * chunk keeps answering Ask questions about canon that no longer exists. The only entity
 * delete this product has today is this one - undoing an accepted `create`/`draft_entity`
 * proposal (C6's "few-seconds fat-finger undo") - reached from two routes
 * (`w/[universe]/proposals/[plan]` and `w/[universe]/import/[job]/review`), both of which
 * import `undoAcceptedProposal` from this module rather than `@canonry/db` directly, so
 * wrapping it once here covers both without either route needing to change.
 *
 * `entityDeletedByUndo` reads which entity (if any) is about to disappear *before* the
 * undo runs, because `@canonry/db`'s raw `undoAcceptedProposal` clears the evidence
 * (`appliedRevisionId`) this needs to find it. Best-effort and never blocking: a Qdrant
 * hiccup or a not-yet-configured embedding model must not turn a successful undo into a
 * failed one, so the cleanup is logged and swallowed, never rethrown. */
async function cleanupEntityIndexAfterDelete(
	db: Db,
	universeId: string,
	entityId: string
): Promise<void> {
	try {
		const embeddingModel = await resolveModel(db, 'embedding');
		const { collectionName, dataSourceId } = await resolveOwnCanonCollection(
			db,
			universeId,
			embeddingModel
		);
		await deleteEntityLoreChunks(
			{ vectorClient: vectorClient() },
			{ collectionName, universeId, dataSourceId, entityId }
		);
	} catch (err) {
		if (err instanceof ModelNotConfiguredError) return;
		console.error(
			JSON.stringify({
				event: 'entity_lore_cleanup_failed',
				universeId,
				entityId,
				message: err instanceof Error ? err.message : String(err)
			})
		);
	}
}

export async function undoAcceptedProposal(
	db: Db,
	input: UndoAcceptedProposalInput
): Promise<ProposalRow> {
	const deletedEntityId = await entityDeletedByUndo(db, input.proposalId);
	const updated = await undoAcceptedProposalRow(db, input);
	if (deletedEntityId) {
		await cleanupEntityIndexAfterDelete(db, updated.universeId, deletedEntityId);
	}
	return updated;
}

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

export interface InboxPlanGroup {
	plan: ProposalPlanRow;
	triggerEntityName: string | null;
	candidates: ProposalCandidate[];
}

/** Issue #498 (V2 = A): every propagation plan the summary above found, resolved down to
 * its full candidate list - the inbox needs the whole card (entry, reason, diff), not
 * just a count. Reuses `planDetailFor` per plan rather than a new join: the number of
 * plans with a pending proposal at once is small, and this keeps one code path ("a
 * plan's candidates") serving both the inbox and the plan's own page. */
export async function propagationGroupsForInbox(
	db: Db,
	universeId: string
): Promise<InboxPlanGroup[]> {
	const plans = await propagationPlansForInbox(db, universeId);
	return Promise.all(
		plans.map(async (p) => {
			const detail = await planDetailFor(db, universeId, p.plan.id);
			return {
				plan: p.plan,
				triggerEntityName: p.triggerEntityName,
				candidates: detail?.candidates ?? []
			};
		})
	);
}

export interface InboxImportGroup {
	job: ImportJobRow;
	candidates: ProposalCandidate[];
}

/** Same widening as `propagationGroupsForInbox`, for the import jobs the summary above
 * found - each resolved through `importJobDetailFor`, the same read the import review
 * route itself uses. */
export async function importGroupsForInbox(
	db: Db,
	universeId: string
): Promise<InboxImportGroup[]> {
	const jobs = await importJobsForInbox(db, universeId);
	return Promise.all(
		jobs.map(async (j) => {
			const detail = await importJobDetailFor(db, universeId, j.job.id);
			return { job: j.job, candidates: detail?.candidates ?? [] };
		})
	);
}

/** The evidence shape `job-runner.ts`'s `matchEvidence` writes onto an import proposal -
 * untrusted jsonb, read defensively exactly like `import/[job]/review/+page.server.ts`'s
 * own `importAcceptFields`, which this mirrors. */
function importAcceptFieldsFor(
	row: ProposalRow,
	job: ImportJobRow
): Omit<AcceptImportProposalInput, 'proposalId' | 'decidedBy'> {
	const evidence = row.evidence as {
		sourceRef?: { path?: string | null };
		contentHash?: string;
	} | null;
	return {
		sourceSystem: job.sourceType,
		externalId: evidence?.sourceRef?.path ?? null,
		sourceUrl: null,
		contentHash: evidence?.contentHash ?? '',
		importJobId: job.id
	};
}

/** Issue #498 (V2 = A): the inbox's own accept, dispatched across every plan's origin
 * rather than trusting the caller to already know whether a proposal came from
 * propagation or from an import. Reject/undo/setRejectReason never needed this split -
 * they write nothing about where a proposal came from - but an import-sourced accept
 * also has to write `entity_source_ref` (SPEC.md Β§6.4) via `acceptAnyImportProposal`,
 * exactly as `import/[job]/review` already does scoped to one job; this is the same
 * dispatch, scoped to a whole universe instead, since the inbox mixes both origins on
 * one page. Throws `ProposalNotFoundError` for a proposal outside this universe, the
 * same failure shape a missing id already produces. */
export async function acceptAnyProposalForUniverse(
	db: Db,
	universeId: string,
	proposalId: string,
	userId: string
): Promise<ProposalRow> {
	const row = await getProposal(db, proposalId);
	if (!row || row.universeId !== universeId) throw new ProposalNotFoundError(proposalId);
	const plan = row.planId ? await getProposalPlan(db, row.planId) : null;
	if (plan?.importJobId) {
		const [job] = await db
			.select()
			.from(importJob)
			.where(eq(importJob.id, plan.importJobId))
			.limit(1);
		if (job) {
			return acceptAnyImportProposal(db, row.kind, {
				proposalId,
				decidedBy: userId,
				...importAcceptFieldsFor(row, job)
			});
		}
	}
	return acceptProposal(db, { proposalId, decidedBy: userId });
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
	/** #196 (decision L1): the shipped-catalogue lookup key (#195) - `ProposalDiffCard`
	 * resolves the display word from this, falling back to `label` for a universe's own
	 * type, which has no catalogue entry. */
	key: string;
	label: string;
	inverseLabel: string;
}

/** One relation waiting on a vocabulary question's answer (issue #190, K1) - the same
 * two-entity-plus-evidence shape an ordinary `relation` proposal already carries,
 * resolved here so the card never has to know it is reading a vocab patch's own
 * `relations` array instead of `targetEntityId`/`relatedEntityId`. */
export interface RelationVocabWaitingRelation {
	fromEntity: EntitySummary | null;
	toEntity: EntitySummary | null;
	rationale: string;
	evidence: unknown;
}

/** A `relation_type_reuse`/`relation_type_widen`/`relation_type_new` candidate's own
 * data (issue #190, K1), read off `proposal.patch` plus whatever entity/relation-type
 * rows it references - resolved once here so `ProposalDiffCard` only ever renders
 * already-looked-up names, never raw ids. `label`/`inverseLabel`/`cardinality`/
 * `allowedFrom`/`allowedTo` describe the type itself: the existing type's own row for
 * reuse/widen, the proposed type's own patch fields for `relation_type_new`.
 * `proposedLabel` (reuse only) is the vocabulary word the model actually used, being
 * folded into `label`. `addFrom`/`addTo` (widen only) name the full pair accepting
 * would add, resolved against the first waiting relation's own entity types when the
 * resolver only needed to widen one side, so the sentence always names a complete
 * pair rather than half of one. */
export interface RelationVocabCandidate {
	kind: 'relation_type_reuse' | 'relation_type_widen' | 'relation_type_new';
	/** #196: the existing type's key for reuse/widen, null for `relation_type_new` -
	 * there is no row yet, so the model's own proposed words are always what renders,
	 * exactly as guardrail 1 requires. */
	key: string | null;
	label: string;
	inverseLabel: string;
	cardinality: RelationCardinality | null;
	allowedFrom: EntityType[];
	allowedTo: EntityType[];
	proposedLabel: string | null;
	addFrom: EntityType | null;
	addTo: EntityType | null;
	relations: RelationVocabWaitingRelation[];
}

export interface ProposalCandidate {
	proposal: ProposalRow;
	/** The entry this candidate updates, or the relation's "from" side. Null for a
	 * `create`/`draft_entity` proposal, which has no target yet. */
	targetEntity: EntitySummary | null;
	/** The relation's "to" side. Null unless `proposal.kind === 'relation'`. */
	relatedEntity: EntitySummary | null;
	relationType: RelationTypeSummary | null;
	/** Set only for the three relation-type vocabulary kinds (issue #190, K1) - null
	 * for everything else, same convention as `relationType` above. */
	relationVocab: RelationVocabCandidate | null;
	/** Derived entry type for D4's filter chips: the target's real type for `update`, the
	 * patch's declared type for `create`/`draft_entity`, `'relation'` for a relation,
	 * `'relation_type'` for the three vocabulary kinds (`proposals.filterBuckets.relation_type`).
	 * A vocabulary patch has no `.type` of its own, so this has to be decided before
	 * `patchType`'s fallback ever runs, or it silently lands in the `character` bucket. */
	filterType: EntityType | 'relation' | 'relation_type';
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

/** The name a `create`/`draft_entity` patch declares. Those two kinds have no target
 * entity yet, so `targetEntity` is null for them by construction (see
 * `ProposalCandidate.targetEntity` above) and the queue used to fall back to a generic
 * "New entry" label, which asked a GM to accept a new entry without ever showing which
 * one. The name is right there in the patch `acceptProposal` will read, so read it here
 * too rather than inventing a second source of truth for it. */
function patchName(patch: unknown): string | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const value = (patch as Record<string, unknown>).name;
	return typeof value === 'string' && value.length > 0 ? value : null;
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
		if (isRelationTypeProposalKind(row.kind)) {
			for (const waiting of (row.patch as RelationTypeVocabPatch).relations) {
				entityIds.add(waiting.fromEntityId);
				entityIds.add(waiting.toEntityId);
			}
		}
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
			? {
					id: relTypeRow.id,
					key: relTypeRow.key,
					label: relTypeRow.label,
					inverseLabel: relTypeRow.inverseLabel
				}
			: null;
		const relationVocab = isRelationTypeProposalKind(row.kind)
			? relationVocabFor(row.patch as RelationTypeVocabPatch, relTypeRow ?? null, entityById)
			: null;

		const filterType: EntityType | 'relation' | 'relation_type' = isRelationTypeProposalKind(
			row.kind
		)
			? 'relation_type'
			: row.kind === 'relation'
				? 'relation'
				: (targetEntity?.type ?? patchType(row.patch) ?? 'character');

		return {
			proposal: row,
			targetEntity,
			relatedEntity,
			relationType: relationTypeSummary,
			relationVocab,
			filterType
		};
	});
}

/** Resolves one vocabulary patch's own data against the already-batched entity/
 * relation-type maps `resolveCandidates` built above - see `RelationVocabCandidate`'s
 * own doc comment for what each field means per kind. `existingTypeRow` is the full
 * `relation_type` row `resolveCandidates` already looked up via `row.relationTypeId`
 * (`proposeRelationTypeVocabulary` sets that column to `existingTypeId` for reuse/
 * widen, so no second query is needed here). */
function relationVocabFor(
	patch: RelationTypeVocabPatch,
	existingTypeRow: typeof relationType.$inferSelect | null,
	entityById: Map<string, typeof entity.$inferSelect>
): RelationVocabCandidate {
	const relations: RelationVocabWaitingRelation[] = patch.relations.map((r) => {
		const fromRow = entityById.get(r.fromEntityId);
		const toRow = entityById.get(r.toEntityId);
		return {
			fromEntity: fromRow ? summarize(fromRow) : null,
			toEntity: toRow ? summarize(toRow) : null,
			rationale: r.rationale,
			evidence: r.evidence
		};
	});

	if (patch.kind === 'relation_type_new') {
		return {
			kind: patch.kind,
			key: null,
			label: patch.label,
			inverseLabel: patch.inverseLabel,
			cardinality: patch.cardinality,
			allowedFrom: patch.allowedFrom,
			allowedTo: patch.allowedTo,
			proposedLabel: null,
			addFrom: null,
			addTo: null,
			relations
		};
	}

	const key = existingTypeRow?.key ?? null;
	const label = existingTypeRow?.label ?? '?';

	const inverseLabel = existingTypeRow?.inverseLabel ?? '?';
	const cardinality = existingTypeRow?.cardinality ?? null;
	const allowedFrom = existingTypeRow?.allowedFrom ?? [];
	const allowedTo = existingTypeRow?.allowedTo ?? [];

	if (patch.kind === 'relation_type_reuse') {
		return {
			kind: patch.kind,
			key,
			label,
			inverseLabel,
			cardinality,
			allowedFrom,
			allowedTo,
			proposedLabel: patch.proposedLabel,
			addFrom: null,
			addTo: null,
			relations
		};
	}

	// `relation_type_widen`: the resolver only ever fills in the side(s) that failed
	// admission (relation-types.ts's own admission check - one, the other, or neither
	// key present), so the missing side falls back to the first waiting relation's own
	// entity type - the side that was already fine - so `addFrom`/`addTo` here always
	// name the complete pair accepting would add, never half of one.
	const first = patch.relations[0];
	const fallbackFrom = first ? (entityById.get(first.fromEntityId)?.type ?? null) : null;
	const fallbackTo = first ? (entityById.get(first.toEntityId)?.type ?? null) : null;
	return {
		kind: patch.kind,
		key,
		label,
		inverseLabel,
		cardinality,
		allowedFrom,
		allowedTo,
		proposedLabel: null,
		addFrom: patch.addFrom ?? fallbackFrom,
		addTo: patch.addTo ?? fallbackTo,
		relations
	};
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

export interface DiffCandidateWaitingRelation {
	fromName: string | null;
	toName: string | null;
	rationale: string;
	evidenceViews: EvidenceView[];
	evidenceCaveat: EvidenceCaveat | null;
}

/** The card-ready mirror of `RelationVocabCandidate` - same fields, entity ids already
 * resolved to display names by `enrichCandidate` below, evidence already normalised
 * exactly like the rest of this file's evidence handling. */
export interface DiffCandidateRelationVocab {
	kind: 'relation_type_reuse' | 'relation_type_widen' | 'relation_type_new';
	key: string | null;
	label: string;
	inverseLabel: string;
	cardinality: RelationCardinality | null;
	allowedFrom: EntityType[];
	allowedTo: EntityType[];
	proposedLabel: string | null;
	addFrom: EntityType | null;
	addTo: EntityType | null;
	relations: DiffCandidateWaitingRelation[];
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
	/** #196: `relationType.key` - null for anything that is not a plain `relation`
	 * proposal, mirroring `relationLabel`'s own null case. */
	relationKey: string | null;
	/** Q1 (#362): the whole diff a reviewer reads, context and all, derived from the
	 * patch's own `before`/`after` rather than stored. */
	diff: ProseDiff;
	evidenceViews: EvidenceView[];
	evidenceCaveat: EvidenceCaveat | null;
	relationVocab: DiffCandidateRelationVocab | null;
	/** Issue #468: true for a still-`pending` `update`/`create`/`draft_entity` candidate
	 * whose patch is still `{}` - C3's checklist gate, before the GM pays for
	 * `propagate.diff`. `diff` above is `EMPTY_PROSE_DIFF` or (worse, for `update`) a
	 * full-body removal in that state, so a caller that means to show a real diff has to
	 * check this first rather than trust `diff.rows.length`. */
	awaitingDiff: boolean;
}

/** Turns one resolved candidate into everything `ProposalDiffCard` needs to render,
 * without the component ever having to know a propagation patch's shape differs from an
 * import patch's. `before` falls back to the target entity's live body when the patch
 * itself carries none (import's `update` patches never set `before` - see
 * `job-runner.ts`'s `materializeDocumentProposals`), so a diff always reads against real
 * current content, exactly like `changedSentencesForEntity` above. */
export function enrichCandidate(candidate: ProposalCandidate): DiffCandidate {
	const p = candidate.proposal;
	let diff: ProseDiff = EMPTY_PROSE_DIFF;
	let awaitingDiff = false;
	if (p.kind === 'update' || p.kind === 'create' || p.kind === 'draft_entity') {
		// C3 only gates a live decision: an already-decided (accepted/rejected) row with a
		// stray empty patch - unreachable via `ProposalQueue`'s own accept/reject, which
		// only ever appears once `generatePlanDiffs` has run, but possible from an older or
		// hand-seeded row - reads as settled, not as still awaiting anything.
		awaitingDiff = p.outcome === 'pending' && !hasDraftedPatch(p.patch);
		// A `create`/`draft_entity` patch keeps its prose in `body`, not in `after`: that is
		// the field `readEntityCreatePatch` reads in `packages/db`'s `acceptProposal`, so it
		// is the field this display path has to read too. Without it the queue rendered an
		// empty diff for every new entry an import proposed, which meant accepting one with
		// its body never shown.
		const after = readPatchAfter(p.patch) ?? readPatchBody(p.patch) ?? '';
		const before =
			p.kind === 'update' ? (readPatchBefore(p.patch) ?? candidate.targetEntity?.body ?? '') : '';
		if (before || after) diff = proseDiff(before, after);
	}
	const { views, caveat } = normalizeEvidence(p.trigger, p.evidence);

	const relationVocab: DiffCandidateRelationVocab | null = candidate.relationVocab
		? {
				kind: candidate.relationVocab.kind,
				key: candidate.relationVocab.key,
				label: candidate.relationVocab.label,
				inverseLabel: candidate.relationVocab.inverseLabel,
				cardinality: candidate.relationVocab.cardinality,
				allowedFrom: candidate.relationVocab.allowedFrom,
				allowedTo: candidate.relationVocab.allowedTo,
				proposedLabel: candidate.relationVocab.proposedLabel,
				addFrom: candidate.relationVocab.addFrom,
				addTo: candidate.relationVocab.addTo,
				relations: candidate.relationVocab.relations.map((r) => {
					const relationEvidence = normalizeEvidence(p.trigger, r.evidence);
					return {
						fromName: r.fromEntity?.name ?? null,
						toName: r.toEntity?.name ?? null,
						rationale: r.rationale,
						evidenceViews: relationEvidence.views,
						evidenceCaveat: relationEvidence.caveat
					};
				})
			}
		: null;

	return {
		id: p.id,
		planId: p.planId,
		kind: p.kind,
		outcome: p.outcome,
		rank: p.rank,
		rationale: p.rationale,
		rejectReason: p.rejectReason,
		credits: p.credits,
		targetName: candidate.targetEntity?.name ?? patchName(p.patch),
		targetType: candidate.targetEntity?.type ?? patchType(p.patch),
		targetSlug: candidate.targetEntity?.slug ?? null,
		relatedName: candidate.relatedEntity?.name ?? null,
		relationLabel: candidate.relationType?.label ?? null,
		relationKey: candidate.relationType?.key ?? null,
		diff,
		evidenceViews: views,
		evidenceCaveat: caveat,
		relationVocab,
		awaitingDiff
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
// #345: the same rows again, but resolved and enriched, so a proposal can be reviewed on
// the entry it targets instead of on a separate screen. Two rules decide what is allowed
// in there, both of them guardrail 1 read carefully:
//
//  - one entry only. `targetEntityId` is the filter, so a region rendered on an entry can
//    never show, let alone accept, a change to a different entry.
//  - a drafted patch only. A propagation candidate exists before its diff does (C3's
//    checklist is where those live, `hasNoDiffYet` in propagate.ts is the same test), and
//    showing an empty diff with an Accept button beside it is exactly the "accepted
//    something they did not read" this product refuses. Those stay counted and keep their
//    link to the plan.
// ---------------------------------------------------------------------------

/** Empty `{}` is what `createProposalPlan` writes for a candidate whose diff has not been
 * generated yet, and what `dropCandidateFromPlan`/`recordProposalDiff` in `@canonry/db`
 * already use to tell an undiffed candidate apart from a drafted one. */
function hasDraftedPatch(patch: unknown): boolean {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return false;
	const record = patch as Record<string, unknown>;
	return typeof record.after === 'string' || typeof record.body === 'string';
}

export interface EntityReviewProposals {
	/** Ready to review in place, focused one at a time, newest last so the one just
	 * generated is the one the region lands on. */
	reviewable: DiffCandidate[];
	/** Pending on this entry with no drafted text yet: a count and the plan that owns them,
	 * which is where C3 says the decision to spend on a diff belongs. */
	awaitingDiff: { count: number; planId: string | null };
}

export async function reviewableProposalsForEntity(
	db: Db,
	universeId: string,
	entityId: string
): Promise<EntityReviewProposals> {
	const rows = await db
		.select()
		.from(proposal)
		.where(
			and(
				eq(proposal.universeId, universeId),
				eq(proposal.targetEntityId, entityId),
				eq(proposal.kind, 'update'),
				eq(proposal.outcome, 'pending')
			)
		)
		.orderBy(proposal.createdAt);

	const drafted = rows.filter((row) => hasDraftedPatch(row.patch));
	const undrafted = rows.filter((row) => !hasDraftedPatch(row.patch));
	const candidates = await resolveCandidates(db, drafted);

	return {
		reviewable: enrichCandidates(candidates),
		awaitingDiff: {
			count: undrafted.length,
			planId: undrafted.find((row) => row.planId !== null)?.planId ?? null
		}
	};
}

/** One proposal, enriched exactly like the queue's own rows, for a surface that knows a
 * proposal id and nothing else (Ask's drafted-proposal card). Universe-scoped: a proposal
 * belonging to another universe reads as absent, never as forbidden-but-real. */
export async function reviewableProposalById(
	db: Db,
	universeId: string,
	proposalId: string
): Promise<DiffCandidate | null> {
	const row = await getProposal(db, proposalId);
	if (!row || row.universeId !== universeId) return null;
	const [candidate] = await resolveCandidates(db, [row]);
	return candidate ? enrichCandidate(candidate) : null;
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

function readPatchBody(patch: unknown): string | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const value = (patch as Record<string, unknown>).body;
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
