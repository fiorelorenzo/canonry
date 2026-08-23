// SPEC.md §4.4, §5.1, guardrail 1. This module is the exclusive writer of canon from a
// proposal - "nothing else in the codebase may write canon from a proposal" - so every
// path that turns a proposal's outcome into a change lives here, in one transaction each,
// never split across a caller and this file.
import { and, eq, desc, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { languageFromAcceptedPatch } from './entities.js';
import { entity } from '../schema/entity.js';
import type {
	EntityType,
	ProposalKind,
	ProposalOutcome,
	ProposalPlanStatus,
	ProposalTrigger
} from '../schema/enums.js';
import { operationPrice } from '../schema/prices.js';
import { proposal, proposalPlan } from '../schema/proposal.js';
import { relation, relationType } from '../schema/relation.js';
import { revision } from '../schema/revision.js';

export type ProposalRow = typeof proposal.$inferSelect;
export type ProposalPlanRow = typeof proposalPlan.$inferSelect;

export class ProposalNotFoundError extends Error {
	constructor(proposalId: string) {
		super(`no proposal row for id "${proposalId}"`);
		this.name = 'ProposalNotFoundError';
	}
}

export class ProposalPlanNotFoundError extends Error {
	constructor(planId: string) {
		super(`no proposal_plan row for id "${planId}"`);
		this.name = 'ProposalPlanNotFoundError';
	}
}

export class ProposalAlreadyDecidedError extends Error {
	constructor(proposalId: string, outcome: ProposalOutcome) {
		super(`proposal "${proposalId}" was already decided (outcome: ${outcome})`);
		this.name = 'ProposalAlreadyDecidedError';
	}
}

/** decision C3: a candidate is droppable only "before any diff is generated". Once
 * `recordProposalDiff` has written a real patch, the candidate has to be rejected instead
 * (SPEC.md §5.1 step 5), not dropped for free. */
export class ProposalHasDiffError extends Error {
	constructor(proposalId: string) {
		super(
			`proposal "${proposalId}" already has a diff; drop only applies before a diff is generated - reject it instead`
		);
		this.name = 'ProposalHasDiffError';
	}
}

/** Guardrail 7 (SPEC.md §5.2) and issue #55: an audit flag reports that two statements
 * disagree, it is a question addressed to the GM and never a change waiting to be
 * applied. `kind: 'flag'` therefore carries no patch and has no accept path at all -
 * refusing it here, rather than leaving the generic "unhandled kind" error to catch it
 * by accident, is what keeps a flag from ever picking up an "accepted" outcome the §14
 * accept-rate query would otherwise have to filter out by trigger to stay honest. The
 * only decision a flag can register is `rejectProposal` ("Dismiss"), which writes no
 * revision and touches no entity. */
export class ProposalCannotBeAcceptedError extends Error {
	constructor(proposalId: string, kind: ProposalKind) {
		super(
			`proposal "${proposalId}" is kind '${kind}' and carries no patch to apply; ` +
				`an audit flag is a question, not a change - dismiss it with rejectProposal instead`
		);
		this.name = 'ProposalCannotBeAcceptedError';
	}
}

/** issue #160: the fallback when a `create`/`draft_entity` accept loses a race onto
 * `entity_universe_slug_key` - two proposals, from the same import job or two different
 * ones, that both slugify to the same name. There is no "who is right" to compute here,
 * so this is only ever thrown when the fallback itself cannot find the entity that must
 * have just won the race (see `foldCreateProposalOntoExistingSlug`) - the ordinary case
 * never reaches it, the losing accept folds onto the winner's entity instead. */
export class EntitySlugCollisionUnresolvedError extends Error {
	constructor(proposalId: string, slug: string) {
		super(`proposal "${proposalId}" collided on slug "${slug}" but no entity holds that slug`);
		this.name = 'EntitySlugCollisionUnresolvedError';
	}
}

/** #191: `allowed_from`/`allowed_to` is a constraint, not a comment, with one meaning on
 * both the shipped catalogue and a universe's own types - a relation may only join entity
 * types the type admits. Enforced right here, where the row is actually written (this
 * module is the exclusive writer of canon from a proposal), not only checked earlier and
 * then trusted - a real error, never a silent drop. #189's resolver is what turns "this
 * pair is not admitted" into a `widen-proposed` a GM can accept instead of a proposal
 * failing here; this is the backstop for anything that reaches accept without having gone
 * through it. */
export class RelationTypeNotAdmittedError extends Error {
	constructor(proposalId: string, typeLabel: string, fromType: EntityType, toType: EntityType) {
		super(
			`proposal "${proposalId}" cannot be accepted: relation type "${typeLabel}" does not admit ${fromType} -> ${toType}`
		);
		this.name = 'RelationTypeNotAdmittedError';
	}
}

/** Issue #613: a relation whose endpoint entity is still one of an import's own pending
 * `create` proposals cannot be written, and refusing it here rather than at the FK is what
 * makes the queue's ordering legible: the message names the proposal the GM has to accept
 * first instead of a constraint name. */
export class RelationEndpointNotAcceptedError extends Error {
	constructor(
		proposalId: string,
		readonly waitingOnProposalIds: string[]
	) {
		super(
			`proposal "${proposalId}" is a relation whose endpoint entry does not exist yet: accept ${waitingOnProposalIds.join(', ')} first`
		);
		this.name = 'RelationEndpointNotAcceptedError';
	}
}

function isEmptyPatch(patch: unknown): boolean {
	return (
		typeof patch === 'object' &&
		patch !== null &&
		!Array.isArray(patch) &&
		Object.keys(patch).length === 0
	);
}

/** Issue #508: the one chargeable operation a plan's trigger prices *per candidate*. This
 * is the unit `proposal_plan.estimated_credits` is made of (see that column's own comment
 * in schema/proposal.ts), so it is also the amount every path that takes a candidate out
 * of `pending` has to move the column by. Null for a trigger whose plan carries no
 * per-candidate figure at all: an import's cost is per document rather than per proposal
 * (`import.document`, charged by the job runner), and a table quick action's plan is
 * written with an estimate of zero on purpose.
 *
 * Declared as a total record rather than a partial one so that adding a seventh trigger to
 * `proposal_trigger` fails to compile until somebody says which operation prices it - the
 * alternative is a new trigger silently getting a zero unit and a column that never moves.
 * The writers charge these same operations by name (`packages/copilot`'s propagate.ts,
 * audit.ts, complete.ts and ask-propose.ts); this map is what keeps the arithmetic on the
 * column in one place instead of once per caller. */
const PER_CANDIDATE_OPERATION: Record<ProposalTrigger, string | null> = {
	save: 'propagate.diff',
	audit: 'audit.flag',
	complete: 'entry.complete',
	ask: 'propagate.diff',
	table: null,
	import: null
};

/** A missing price row means the catalogue was edited by hand: `priceOf` throws for an
 * unpriced operation precisely so a silent zero cannot make something free by accident
 * (SPEC.md §15). Here it deliberately reads as zero instead of throwing, because the
 * caller is an accept, a reject or a drop: refusing a GM's decision over a pricing row is
 * worse than leaving one plan's estimate too high, and nothing about the decision itself
 * depends on the number. */
async function perCandidateCredits(tx: Queryable, trigger: ProposalTrigger): Promise<number> {
	const operation = PER_CANDIDATE_OPERATION[trigger];
	if (!operation) return 0;
	const [row] = await tx
		.select({ credits: operationPrice.credits })
		.from(operationPrice)
		.where(eq(operationPrice.operation, operation))
		.limit(1);
	return row?.credits ?? 0;
}

/** Issue #508: the single place `proposal_plan.estimated_credits` moves. Called with -1 by
 * every path that takes a candidate out of `pending` (accept, reject, drop) and with +1 by
 * the one path that puts it back (`undoAcceptedProposal`), always inside the caller's own
 * transaction and after the proposal row is already locked, so the two locks are always
 * taken in the same order (proposal, then plan) and a concurrent accept and drop on one
 * plan queue instead of deadlocking.
 *
 * Clamped at zero rather than allowed negative: a plan whose stored estimate was already
 * lower than its candidates are worth (every plan written before this issue) walks down to
 * zero and stops, instead of turning into a negative number no reader knows how to show. */
async function shiftPlanEstimate(
	tx: Queryable,
	planId: string,
	openCandidateDelta: -1 | 1
): Promise<ProposalPlanRow> {
	const [plan] = await tx
		.select()
		.from(proposalPlan)
		.where(eq(proposalPlan.id, planId))
		.for('update')
		.limit(1);
	if (!plan) throw new ProposalPlanNotFoundError(planId);

	const unit = await perCandidateCredits(tx, plan.trigger);
	// Rounded to `estimated_credits`'s own numeric(12,4) scale: repeated float subtraction of
	// a price like 0.3 otherwise leaves 0.7999999999999999 in a column that holds four
	// decimals, and the difference reads as a figure that never quite reaches zero.
	const next =
		Math.round(Math.max(0, plan.estimatedCredits + openCandidateDelta * unit) * 10_000) / 10_000;
	if (next === plan.estimatedCredits) return plan;

	const [updated] = await tx
		.update(proposalPlan)
		.set({ estimatedCredits: next })
		.where(eq(proposalPlan.id, plan.id))
		.returning();
	if (!updated) throw new Error('shiftPlanEstimate: update returned no plan row');
	return updated;
}

// ---------------------------------------------------------------------------
// Issue #613: relation proposals whose endpoint entity is another proposal.
//
// One import writes the whole page tree at once, so on a first import both ends of every
// parent/subpage relation are entries the same job is only proposing. Such a relation is a
// real, pending `relation` proposal from the start, with the endpoint named by the proposal
// that will create the entity (`target_entity_proposal_id` /
// `related_entity_proposal_id`, whose own comment in schema/proposal.ts carries the state
// table). The three functions below are the whole lifecycle of that pointer, and every one
// of them is bookkeeping on a still-pending row rather than a write to canon:
//
//  - `resolveRelationEndpoints` runs inside an entity accept and fills in the entity id the
//    accept just created, which makes the relation acceptable and nothing more;
//  - `supersedeRelationsWaitingOn` runs inside a reject and settles the relations that can
//    now never resolve, as `superseded` rather than `rejected` (see the call site for the
//    argument);
//  - `unresolveRelationEndpoints` runs inside an undo and puts the pointer back, so C6's
//    few-seconds undo leaves the queue exactly where it was instead of letting the FK
//    cascade take the relation away with the entity.
// ---------------------------------------------------------------------------

/** Fills in `target_entity_id` / `related_entity_id` on every still-pending relation
 * proposal that named `endpointProposalId` as the proposal behind that end. The proposal id
 * stays where it is: it is the provenance a review screen shows and the key the undo below
 * reads. Returns how many rows moved, for a caller that wants to say so. */
async function resolveRelationEndpoints(
	tx: Queryable,
	endpointProposalId: string,
	entityId: string
): Promise<number> {
	const target = await tx
		.update(proposal)
		.set({ targetEntityId: entityId })
		.where(
			and(
				eq(proposal.targetEntityProposalId, endpointProposalId),
				eq(proposal.outcome, 'pending'),
				isNull(proposal.targetEntityId)
			)
		)
		.returning({ id: proposal.id });
	const related = await tx
		.update(proposal)
		.set({ relatedEntityId: entityId })
		.where(
			and(
				eq(proposal.relatedEntityProposalId, endpointProposalId),
				eq(proposal.outcome, 'pending'),
				isNull(proposal.relatedEntityId)
			)
		)
		.returning({ id: proposal.id });
	return new Set([...target, ...related].map((row) => row.id)).size;
}

/** The inverse, for `undoAcceptedProposal`: the entity this accept created is about to be
 * deleted, so any relation proposal that resolved onto it goes back to waiting on this
 * proposal. Scoped by the proposal id rather than by the entity id, because an ordinary
 * relation whose end was already canon has no endpoint proposal and must not be touched. */
async function unresolveRelationEndpoints(
	tx: Queryable,
	endpointProposalId: string
): Promise<void> {
	await tx
		.update(proposal)
		.set({ targetEntityId: null })
		.where(
			and(eq(proposal.targetEntityProposalId, endpointProposalId), eq(proposal.outcome, 'pending'))
		);
	await tx
		.update(proposal)
		.set({ relatedEntityId: null })
		.where(
			and(eq(proposal.relatedEntityProposalId, endpointProposalId), eq(proposal.outcome, 'pending'))
		);
}

/** Settles every still-pending relation proposal waiting on a proposal that has just been
 * rejected: without this they would sit `pending` forever, pointing at an entry that is
 * never going to exist, and the GM would have no way to see why they cannot be accepted.
 *
 * `superseded`, not `rejected`, and the distinction is load-bearing rather than tidy: the
 * GM decided the *entry*, not the relation, and `proposal_outcome`'s own comment says that
 * counting an undecided proposal as a rejection poisons the accept rate SPEC.md §14 makes
 * the deciding metric. `reject_reason` still carries a machine-readable word, because a
 * settled row with no reason is exactly the silent no-op this issue is about.
 *
 * Returns the ids it settled. */
async function supersedeRelationsWaitingOn(
	tx: Queryable,
	endpointProposalId: string
): Promise<string[]> {
	const settled = await tx
		.update(proposal)
		.set({
			outcome: 'superseded',
			decidedAt: new Date(),
			rejectReason: RELATION_ENDPOINT_REJECTED
		})
		.where(
			and(
				eq(proposal.outcome, 'pending'),
				or(
					eq(proposal.targetEntityProposalId, endpointProposalId),
					eq(proposal.relatedEntityProposalId, endpointProposalId)
				)
			)
		)
		.returning({ id: proposal.id });
	return settled.map((row) => row.id);
}

/** The `reject_reason` a relation carries when its endpoint entry was rejected. A stable
 * word rather than a sentence, because it is read by the review screen (which localises it)
 * and by the accept-rate query (which excludes it), not by a person. */
export const RELATION_ENDPOINT_REJECTED = 'endpoint_rejected';

export interface CreateProposalPlanCandidate {
	kind: ProposalKind;
	targetEntityId: string | null;
	relationTypeId?: string | null;
	relatedEntityId?: string | null;
	/** Issue #613: this relation candidate's "from" end is not an entity yet, it is the
	 * candidate at this index in this same `candidates` array (an import's own `create`
	 * for the entry, which has no row and therefore no id until this insert runs). Resolved
	 * to `proposal.target_entity_proposal_id` inside the same transaction, so a relation row
	 * never exists with both an unset entity and an unset proposal at one end - a state no
	 * reader could interpret and no accept could refuse legibly.
	 *
	 * An index rather than an id because that is all a caller can honestly know before the
	 * insert, and it cannot name a row outside this plan by accident. Ignored for any kind
	 * other than `relation`. */
	targetEntityProposalIndex?: number | null;
	/** The same for the "to" end. */
	relatedEntityProposalIndex?: number | null;
	/** Issue #613, the other half: an endpoint that is a `create` proposal an *earlier*
	 * document in this same job already wrote (issue #160's fold), so its id is known and
	 * no index is needed. Exactly one of this and the index above is ever set for one end.
	 */
	targetEntityProposalId?: string | null;
	relatedEntityProposalId?: string | null;
	rationale: string;
	/** Shape is the writer's (packages/copilot's `CandidateEvidence[]` for propagation) -
	 * this module never interprets it, only stores and returns it. */
	evidence: unknown;
	rank: number;
	/** Issue #508: what this candidate has already cost, when its trigger pays for it the
	 * moment it is written. An audit flag is the case that needs it: the flag is fully
	 * drafted and charged (`audit.flag`) by the time the plan row exists, so its row
	 * figure is a real number rather than the 0 it used to carry, and the plan screen's
	 * per-row credits mean something for that trigger too. Omitted (0) for a candidate
	 * whose work has not happened yet: a propagation candidate is priced later, by
	 * `recordProposalDiff`, when the `propagate.diff` charge actually lands. */
	credits?: number;
}

export interface CreateProposalPlanInput {
	universeId: string;
	trigger: ProposalTrigger;
	triggerEntityId?: string | null;
	triggerRevisionId?: string | null;
	/** The import run this plan came from, for trigger = 'import'. Omit or pass null for
	 * any other trigger. */
	importJobId?: string | null;
	summary: string;
	candidateCap: number | null;
	/** Issue #508: what the candidates in this plan are worth at today's prices, which is
	 * what `proposal_plan.estimated_credits` means (that column's own comment in
	 * schema/proposal.ts is the definition). A caller writing a plan whose trigger prices
	 * per candidate passes `candidates.length` times that trigger's per-candidate price,
	 * and nothing else: a plan-level charge that has already been spent (propagation's
	 * `propagate.plan` ranking pass) does not belong in it, because from here on every
	 * accept, reject and drop moves this figure by exactly one candidate's price. */
	estimatedCredits: number;
	/** SPEC.md §17: the interface language the plan's own speech was written in, applied to every
	 * proposal in it, because one plan has one caller and therefore one reader. This is not the
	 * language of the canon these proposals edit: that lives per entry on `entity.language`, and
	 * a proposal legitimately carries both at once. Recorded so accept rate can be read per
	 * locale, which is the only way to notice that Italian proposals are being accepted at half
	 * the English rate while the aggregate stays healthy. */
	locale?: string | null;
	candidates: CreateProposalPlanCandidate[];
}

export interface CreateProposalPlanResult {
	plan: ProposalPlanRow;
	proposals: ProposalRow[];
}

/** issue #50: writes the readable, editable plan and its per-candidate placeholder rows in
 * one transaction. Every candidate lands with `patch: {}` - "no diff yet" - which is what
 * `dropCandidateFromPlan` and `recordProposalDiff` use to tell an undiffed candidate apart
 * from one whose diff (and its `propagate.diff` charge) has already been written. */
export async function createProposalPlan(
	db: Db,
	input: CreateProposalPlanInput
): Promise<CreateProposalPlanResult> {
	return db.transaction(async (tx) => {
		const [plan] = await tx
			.insert(proposalPlan)
			.values({
				universeId: input.universeId,
				trigger: input.trigger,
				triggerEntityId: input.triggerEntityId ?? null,
				triggerRevisionId: input.triggerRevisionId ?? null,
				importJobId: input.importJobId ?? null,
				summary: input.summary,
				status: 'ready',
				estimatedCredits: input.estimatedCredits,
				candidateCap: input.candidateCap
			})
			.returning();
		if (!plan) throw new Error('createProposalPlan: insert returned no plan row');
		if (input.candidates.length === 0) return { plan, proposals: [] };

		const proposals = await tx
			.insert(proposal)
			.values(
				input.candidates.map((candidate) => ({
					universeId: input.universeId,
					planId: plan.id,
					trigger: input.trigger,
					kind: candidate.kind,
					targetEntityId: candidate.targetEntityId,
					relationTypeId: candidate.relationTypeId ?? null,
					relatedEntityId: candidate.relatedEntityId ?? null,
					targetEntityProposalId: candidate.targetEntityProposalId ?? null,
					relatedEntityProposalId: candidate.relatedEntityProposalId ?? null,
					patch: {},
					rationale: candidate.rationale,
					evidence: candidate.evidence,
					rank: candidate.rank,
					credits: candidate.credits ?? 0,
					locale: input.locale ?? null,
					outcome: 'pending' as const
				}))
			)
			.returning();

		// Issue #613: the second half of the insert, and it has to be a second statement
		// because a candidate naming a sibling by index is naming a row whose id the
		// database only just chose. Same transaction, so nothing outside it ever sees a
		// relation candidate with an unset endpoint at both ends.
		const endpointUpdates = input.candidates.flatMap((candidate, index) => {
			const targetIndex = candidate.targetEntityProposalIndex;
			const relatedIndex = candidate.relatedEntityProposalIndex;
			if (targetIndex == null && relatedIndex == null) return [];
			const row = proposals[index];
			if (!row) return [];
			const patch: { targetEntityProposalId?: string; relatedEntityProposalId?: string } = {};
			if (targetIndex != null) {
				const referenced = proposals[targetIndex];
				if (!referenced) {
					throw new Error(
						`createProposalPlan: candidate ${index} names targetEntityProposalIndex ${targetIndex}, which is not a candidate in this plan`
					);
				}
				patch.targetEntityProposalId = referenced.id;
			}
			if (relatedIndex != null) {
				const referenced = proposals[relatedIndex];
				if (!referenced) {
					throw new Error(
						`createProposalPlan: candidate ${index} names relatedEntityProposalIndex ${relatedIndex}, which is not a candidate in this plan`
					);
				}
				patch.relatedEntityProposalId = referenced.id;
			}
			return [{ id: row.id, patch }];
		});
		if (endpointUpdates.length === 0) return { plan, proposals };

		for (const update of endpointUpdates) {
			await tx.update(proposal).set(update.patch).where(eq(proposal.id, update.id));
		}
		const resolved = await tx
			.select()
			.from(proposal)
			.where(
				inArray(
					proposal.id,
					proposals.map((row) => row.id)
				)
			);
		const byId = new Map(resolved.map((row) => [row.id, row]));
		return { plan, proposals: proposals.map((row) => byId.get(row.id) ?? row) };
	});
}

export interface DropCandidateResult {
	plan: ProposalPlanRow;
	dropped: ProposalRow;
}

/** decision C3: the GM can drop an entry from the plan before any diff is generated.
 * Issue #508: takes the dropped candidate's own worth off `proposal_plan.estimated_credits`
 * at the price its plan's trigger implies, which for an audit plan is `audit.flag` and not
 * `propagate.diff`. That distinction was invisible while both rows read 1 credit, and an
 * admin repricing either one unmasked it. */
export async function dropCandidateFromPlan(
	db: Db,
	proposalId: string
): Promise<DropCandidateResult> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(proposalId);
		if (existing.outcome !== 'pending') {
			throw new ProposalAlreadyDecidedError(proposalId, existing.outcome);
		}
		if (!existing.planId) throw new Error(`proposal "${proposalId}" has no plan to drop from`);
		if (!isEmptyPatch(existing.patch)) throw new ProposalHasDiffError(proposalId);

		const updatedPlan = await shiftPlanEstimate(tx, existing.planId, -1);

		await tx.delete(proposal).where(eq(proposal.id, proposalId));

		return { plan: updatedPlan, dropped: existing };
	});
}

export interface RecordProposalDiffInput {
	proposalId: string;
	/** Shape is the writer's (packages/copilot's `EntityUpdatePatch`) - see that module's
	 * doc comment for the fields `acceptProposal` below reads back out of this column. */
	patch: unknown;
	provider: string;
	modelId: string;
	credits: number;
}

/** issue #51: records the premium model's diff onto a candidate that survived the plan.
 * Only valid while the proposal is still pending - a diff never overwrites a decision
 * that already happened. */
export async function recordProposalDiff(
	db: Db,
	input: RecordProposalDiffInput
): Promise<ProposalRow> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(input.proposalId);
		if (existing.outcome !== 'pending') {
			throw new ProposalAlreadyDecidedError(input.proposalId, existing.outcome);
		}

		const [updated] = await tx
			.update(proposal)
			.set({
				patch: input.patch,
				provider: input.provider,
				modelId: input.modelId,
				credits: input.credits
			})
			.where(eq(proposal.id, input.proposalId))
			.returning();
		if (!updated) throw new Error('recordProposalDiff: update returned no row');
		return updated;
	});
}

export async function setProposalPlanStatus(
	db: Db,
	planId: string,
	status: ProposalPlanStatus
): Promise<ProposalPlanRow> {
	const [updated] = await db
		.update(proposalPlan)
		.set({ status })
		.where(eq(proposalPlan.id, planId))
		.returning();
	if (!updated) throw new ProposalPlanNotFoundError(planId);
	return updated;
}

export async function listProposalsForPlan(db: Db, planId: string): Promise<ProposalRow[]> {
	return db.select().from(proposal).where(eq(proposal.planId, planId)).orderBy(proposal.rank);
}

export async function getProposalPlan(db: Db, planId: string): Promise<ProposalPlanRow | null> {
	const rows = await db.select().from(proposalPlan).where(eq(proposalPlan.id, planId)).limit(1);
	return rows[0] ?? null;
}

export async function getProposal(db: Db, proposalId: string): Promise<ProposalRow | null> {
	const rows = await db.select().from(proposal).where(eq(proposal.id, proposalId)).limit(1);
	return rows[0] ?? null;
}

export interface RejectedProposalRecord {
	targetEntityId: string | null;
	/** The raw evidence blob a rejected proposal carried - packages/copilot's
	 * reject-signal.ts is the reader that knows the shape. */
	evidence: unknown;
	reason: string | null;
}

/** issue #56: raw rejected-proposal rows for a universe, newest first, for
 * packages/copilot's reject-signal.ts to turn into ranking weights. Deliberately returns
 * the raw evidence blob rather than parsing it - this module does not interpret
 * `proposal.evidence`'s shape, only the writer does. */
export async function rejectedProposalsFor(
	db: Db,
	universeId: string,
	limit = 200
): Promise<RejectedProposalRecord[]> {
	return db
		.select({
			targetEntityId: proposal.targetEntityId,
			evidence: proposal.evidence,
			reason: proposal.rejectReason
		})
		.from(proposal)
		.where(and(eq(proposal.universeId, universeId), eq(proposal.outcome, 'rejected')))
		.orderBy(desc(proposal.decidedAt))
		.limit(limit);
}

interface EntityUpdatePatchShape {
	after?: string;
	name?: string;
	aliases?: string[];
	/** ImportLanguage's per-document signal (issue #125), preferred over re-detecting
	 * from a merged summary when accept runs the write - see `languageFromAcceptedPatch`. */
	language?: string;
}

function readEntityUpdatePatch(patch: unknown): EntityUpdatePatchShape {
	if (typeof patch !== 'object' || patch === null) return {};
	const record = patch as Record<string, unknown>;
	const result: EntityUpdatePatchShape = {};
	if (typeof record.after === 'string') result.after = record.after;
	if (typeof record.name === 'string') result.name = record.name;
	if (Array.isArray(record.aliases) && record.aliases.every((a) => typeof a === 'string')) {
		result.aliases = record.aliases as string[];
	}
	if (typeof record.language === 'string') result.language = record.language;
	return result;
}

export interface EntityCreatePatchShape {
	type: EntityType;
	name: string;
	slug: string;
	aliases: string[];
	body: string;
	language?: string;
}

export function readEntityCreatePatch(patch: unknown): EntityCreatePatchShape {
	if (typeof patch !== 'object' || patch === null) {
		throw new Error(
			"acceptProposal: kind 'create'/'draft_entity' requires a patch with type, name and slug"
		);
	}
	const record = patch as Record<string, unknown>;
	const type = record.type;
	const name = record.name;
	const slug = record.slug;
	if (typeof type !== 'string' || typeof name !== 'string' || typeof slug !== 'string') {
		throw new Error(
			"acceptProposal: kind 'create'/'draft_entity' requires a patch with type, name and slug"
		);
	}
	const aliases =
		Array.isArray(record.aliases) && record.aliases.every((a) => typeof a === 'string')
			? (record.aliases as string[])
			: [];
	const body = typeof record.body === 'string' ? record.body : '';
	return {
		type: type as EntityType,
		name,
		slug,
		aliases,
		body,
		...(typeof record.language === 'string' ? { language: record.language } : {})
	};
}

/** Local alias for the subset of `Db` a transaction handle actually is - drizzle's
 * transaction callback param is not literally `Db`, and importing its real type across
 * every query file that needs it is more coupling than a three-method Pick is worth
 * (billing.ts and subscriptions.ts already each keep their own copy of this same alias). */
type Queryable = Pick<Db, 'select' | 'insert' | 'update'>;

/** Shared by a real `update`-kind accept and the slug-collision fallback below: locks
 * `entityId`, asks `resolve` to turn its current fields into the next ones, writes the
 * revision and applies it to the entity, all inside the caller's own transaction. */
async function writeEntityUpdateRevision(
	tx: Queryable,
	input: {
		universeId: string;
		entityId: string;
		proposalId: string;
		resolve: (current: {
			name: string;
			aliases: string[];
			body: string;
			language: string | null;
			languageSource: 'detected' | 'human';
		}) => { name: string; aliases: string[]; body: string; language: string | undefined };
	}
): Promise<string> {
	const [entityRow] = await tx
		.select()
		.from(entity)
		.where(eq(entity.id, input.entityId))
		.for('update')
		.limit(1);
	if (!entityRow) {
		throw new Error(`proposal "${input.proposalId}" targets missing entity "${input.entityId}"`);
	}
	const next = input.resolve(entityRow);
	const nextLanguage = languageFromAcceptedPatch(
		{ language: entityRow.language, languageSource: entityRow.languageSource },
		next.language,
		next.body
	);

	const [rev] = await tx
		.insert(revision)
		.values({
			universeId: input.universeId,
			entityId: input.entityId,
			authorKind: 'ai_accepted',
			proposalId: input.proposalId,
			name: next.name,
			aliases: next.aliases,
			body: next.body
		})
		.returning();
	if (!rev) throw new Error('acceptProposal: revision insert returned no row');

	await tx
		.update(entity)
		.set({
			name: next.name,
			aliases: next.aliases,
			body: next.body,
			language: nextLanguage.language,
			languageSource: nextLanguage.languageSource,
			updatedAt: new Date()
		})
		.where(eq(entity.id, input.entityId));
	return rev.id;
}

export interface AcceptProposalInput {
	proposalId: string;
	decidedBy?: string | null;
}

/** Guardrail 1's boundary: the only place a proposal's content reaches canon. One
 * transaction, always: flip `outcome` to accepted, write the `revision` (author_kind
 * `ai_accepted`, `proposal_id` set), apply the change to `entity` (or write the relation),
 * and set `applied_revision_id`. Accepting an already-accepted proposal is a no-op - the
 * row lock taken here serializes a concurrent double-accept, so the second caller always
 * sees `outcome: 'accepted'` and returns without writing a second revision.
 *
 * issue #160: a `create`/`draft_entity` accept can still lose a race onto
 * `entity_universe_slug_key` even with the merge engine now matching a job's own pending
 * proposals (job-runner.ts's `materializeDocumentProposals`) - two different import jobs,
 * or an import racing a manually authored "new entity", can independently slugify to the
 * same name. That unique violation used to reach the caller as a raw `DrizzleQueryError`
 * with the whole INSERT statement in its message - a GM would see a 500. It is caught
 * here instead: `foldCreateProposalOntoExistingSlug` treats the entity that won the race
 * as this proposal's real target and applies its patch to that entity as an update. */
export async function acceptProposal(db: Db, input: AcceptProposalInput): Promise<ProposalRow> {
	try {
		return await acceptProposalTx(db, input);
	} catch (err) {
		// Postgres reports a unique violation as a `DrizzleQueryError` whose own `.message`
		// is just "Failed query: ...params" - the real Postgres error, with the constraint
		// that fired, is on `.cause`. Checking that, rather than the message text, is what
		// proves *which* constraint tripped (same check as supersede.ts's own copy of it).
		const cause = err && typeof err === 'object' && 'cause' in err ? err.cause : undefined;
		const isSlugCollision =
			cause &&
			typeof cause === 'object' &&
			'constraint_name' in cause &&
			cause.constraint_name === 'entity_universe_slug_key';
		if (!isSlugCollision) throw err;
		return foldCreateProposalOntoExistingSlug(db, input);
	}
}

async function acceptProposalTx(db: Db, input: AcceptProposalInput): Promise<ProposalRow> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(input.proposalId);
		if (existing.outcome === 'accepted') return existing;
		if (existing.outcome !== 'pending') {
			throw new ProposalAlreadyDecidedError(input.proposalId, existing.outcome);
		}

		let appliedRevisionId: string | null = null;

		if (existing.kind === 'update') {
			if (!existing.targetEntityId) {
				throw new Error(`proposal "${existing.id}" is kind 'update' with no target entity`);
			}
			const patch = readEntityUpdatePatch(existing.patch);
			appliedRevisionId = await writeEntityUpdateRevision(tx, {
				universeId: existing.universeId,
				entityId: existing.targetEntityId,
				proposalId: existing.id,
				resolve: (current) => ({
					name: patch.name ?? current.name,
					aliases: patch.aliases ?? current.aliases,
					body: patch.after ?? current.body,
					language: patch.language
				})
			});
		} else if (existing.kind === 'create' || existing.kind === 'draft_entity') {
			const patch = readEntityCreatePatch(existing.patch);
			const createdLanguage = languageFromAcceptedPatch(
				{ language: null, languageSource: 'detected' },
				patch.language,
				patch.body
			);
			const [createdEntity] = await tx
				.insert(entity)
				.values({
					universeId: existing.universeId,
					type: patch.type,
					name: patch.name,
					slug: patch.slug,
					aliases: patch.aliases,
					body: patch.body,
					language: createdLanguage.language,
					languageSource: createdLanguage.languageSource
				})
				.returning();
			if (!createdEntity) throw new Error('acceptProposal: entity insert returned no row');

			const [rev] = await tx
				.insert(revision)
				.values({
					universeId: existing.universeId,
					entityId: createdEntity.id,
					authorKind: 'ai_accepted',
					proposalId: existing.id,
					name: createdEntity.name,
					aliases: createdEntity.aliases,
					body: createdEntity.body
				})
				.returning();
			if (!rev) throw new Error('acceptProposal: revision insert returned no row');
			appliedRevisionId = rev.id;
			// Issue #613: an import that proposed a page tree also proposed the relations
			// between its pages, and those name this proposal rather than an entity, because
			// this entity did not exist when the plan was written. This is the moment it
			// does. Bookkeeping on rows that stay `pending`: it writes no relation and
			// nothing reaches canon, it only makes the waiting relations acceptable, each
			// still on its own accept with its own allowed_from/allowed_to check.
			await resolveRelationEndpoints(tx, existing.id, createdEntity.id);
		} else if (existing.kind === 'relation') {
			// Issue #613: an endpoint still waiting on its own proposal is refused by name
			// rather than by a null-check message, so a caller can turn it into "accept the
			// two entries first" instead of a 500.
			const waitingOn = [
				...(existing.targetEntityId ? [] : [existing.targetEntityProposalId]),
				...(existing.relatedEntityId ? [] : [existing.relatedEntityProposalId])
			].filter((id): id is string => typeof id === 'string');
			if (waitingOn.length > 0) {
				throw new RelationEndpointNotAcceptedError(existing.id, waitingOn);
			}
			if (!existing.relationTypeId || !existing.targetEntityId || !existing.relatedEntityId) {
				throw new Error(
					`proposal "${existing.id}" is kind 'relation' but is missing relationTypeId, targetEntityId or relatedEntityId`
				);
			}
			const [type] = await tx
				.select({
					label: relationType.label,
					allowedFrom: relationType.allowedFrom,
					allowedTo: relationType.allowedTo
				})
				.from(relationType)
				.where(eq(relationType.id, existing.relationTypeId))
				.limit(1);
			if (!type) {
				throw new Error(
					`proposal "${existing.id}" targets missing relation_type "${existing.relationTypeId}"`
				);
			}
			const [fromEntity] = await tx
				.select({ type: entity.type })
				.from(entity)
				.where(eq(entity.id, existing.targetEntityId))
				.limit(1);
			const [toEntity] = await tx
				.select({ type: entity.type })
				.from(entity)
				.where(eq(entity.id, existing.relatedEntityId))
				.limit(1);
			if (!fromEntity || !toEntity) {
				throw new Error(`proposal "${existing.id}" targets a missing entity`);
			}
			// #191: allowed_from/allowed_to is a constraint on both the shipped catalogue and
			// a universe's own types, enforced here where the row is actually written rather
			// than only checked earlier and trusted - a pair the type does not admit never
			// reaches the table, whatever proposed it.
			if (!type.allowedFrom.includes(fromEntity.type) || !type.allowedTo.includes(toEntity.type)) {
				throw new RelationTypeNotAdmittedError(
					existing.id,
					type.label,
					fromEntity.type,
					toEntity.type
				);
			}
			await tx.insert(relation).values({
				universeId: existing.universeId,
				relationTypeId: existing.relationTypeId,
				fromEntityId: existing.targetEntityId,
				toEntityId: existing.relatedEntityId,
				authorKind: 'ai_accepted'
			});
			// A relation carries its own author_kind and has no entity body to snapshot into a
			// revision, so appliedRevisionId stays null for this kind.
		} else if (existing.kind === 'flag') {
			throw new ProposalCannotBeAcceptedError(existing.id, existing.kind);
		} else {
			throw new Error(`acceptProposal: unhandled proposal kind "${existing.kind}"`);
		}

		const [updated] = await tx
			.update(proposal)
			.set({
				outcome: 'accepted',
				decidedAt: new Date(),
				decidedBy: input.decidedBy ?? null,
				appliedRevisionId
			})
			.where(eq(proposal.id, existing.id))
			.returning();
		if (!updated) throw new Error('acceptProposal: update returned no row');

		// Issue #508: this candidate is no longer one of the plan's open ones, so its worth
		// comes off the plan's estimate in the same transaction as the decision. Without
		// this, the column only ever moved on a drop, and a plan whose candidates were all
		// accepted kept advertising them as still outstanding forever.
		if (existing.planId) await shiftPlanEstimate(tx, existing.planId, -1);
		return updated;
	});
}

/** issue #160: re-locks the proposal that lost the `entity_universe_slug_key` race (the
 * transaction that hit it has already rolled back in full, so there is nothing partial
 * to undo here) and, if it is still a pending create, folds its patch onto whichever
 * entity now holds that slug instead of retrying the insert. Anything other than a
 * fresh, still-pending create hitting this constraint is not a shape this fallback
 * recognises, so it re-throws rather than guessing what happened. */
async function foldCreateProposalOntoExistingSlug(
	db: Db,
	input: AcceptProposalInput
): Promise<ProposalRow> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(input.proposalId);
		if (existing.outcome === 'accepted') return existing;
		if (existing.outcome !== 'pending') {
			throw new ProposalAlreadyDecidedError(input.proposalId, existing.outcome);
		}
		if (existing.kind !== 'create' && existing.kind !== 'draft_entity') {
			throw new Error(
				`proposal "${existing.id}" hit entity_universe_slug_key but is kind '${existing.kind}', not a create`
			);
		}

		const patch = readEntityCreatePatch(existing.patch);
		const [target] = await tx
			.select()
			.from(entity)
			.where(and(eq(entity.universeId, existing.universeId), eq(entity.slug, patch.slug)))
			.limit(1);
		if (!target) throw new EntitySlugCollisionUnresolvedError(existing.id, patch.slug);

		const appliedRevisionId = await writeEntityUpdateRevision(tx, {
			universeId: existing.universeId,
			entityId: target.id,
			proposalId: existing.id,
			resolve: () => ({
				name: patch.name,
				aliases: patch.aliases,
				body: patch.body,
				language: patch.language
			})
		});

		// Issue #613: this accept still produced the entry the waiting relations named, it
		// just landed on a row that already existed rather than a new one. The relations
		// have to resolve onto that row, or a create that lost a slug race would silently
		// leave its whole subtree unacceptable.
		await resolveRelationEndpoints(tx, existing.id, target.id);

		const [updated] = await tx
			.update(proposal)
			.set({
				outcome: 'accepted',
				decidedAt: new Date(),
				decidedBy: input.decidedBy ?? null,
				appliedRevisionId,
				// Kind stays 'create' - it is honest history that this was proposed as a new
				// entity - but the target is now recorded, since it did land as an update onto
				// an entity that turned out to already exist by the time this was accepted.
				targetEntityId: target.id
			})
			.where(eq(proposal.id, existing.id))
			.returning();
		if (!updated) throw new Error('acceptProposal: update returned no row');

		// Issue #508, same as the ordinary accept above: this candidate is decided, so the
		// plan stops counting it among the ones it is still expected to spend on.
		if (existing.planId) await shiftPlanEstimate(tx, existing.planId, -1);
		return updated;
	});
}

export interface RejectProposalInput {
	proposalId: string;
	/** decision C7: "skipping is a valid outcome" - reason is optional, never required. */
	reason?: string | null;
	decidedBy?: string | null;
}

/** SPEC.md §5.1 step 5 and decision C7: rejection stores the one-word reason, or none at
 * all. Rejecting an already-rejected proposal is a no-op - "never re-ask about a proposal
 * already rejected" is explicit in the decision, and the row lock here makes a concurrent
 * double-reject safe the same way `acceptProposal`'s does. */
export async function rejectProposal(db: Db, input: RejectProposalInput): Promise<ProposalRow> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(input.proposalId);
		if (existing.outcome === 'rejected') return existing;
		if (existing.outcome !== 'pending') {
			throw new ProposalAlreadyDecidedError(input.proposalId, existing.outcome);
		}

		const [updated] = await tx
			.update(proposal)
			.set({
				outcome: 'rejected',
				rejectReason: input.reason ?? null,
				decidedAt: new Date(),
				decidedBy: input.decidedBy ?? null
			})
			.where(eq(proposal.id, existing.id))
			.returning();
		if (!updated) throw new Error('rejectProposal: update returned no row');

		// Issue #613: nothing is ever going to create the entry this proposal named, so a
		// relation waiting on it can never resolve. Left alone it would sit `pending`
		// forever, refusing every accept with no way for the GM to see why, which is the
		// dangling-row failure this issue exists to avoid rather than trade for. Settled
		// here, in the same transaction as the decision that caused it.
		await supersedeRelationsWaitingOn(tx, existing.id);

		// Issue #508: a rejected candidate is no longer one of the plan's open ones. The
		// early return above for an already-rejected row is what keeps a double reject from
		// taking its price off twice.
		if (existing.planId) await shiftPlanEstimate(tx, existing.planId, -1);
		return updated;
	});
}

/** C7's "right after the reject" chip picker: the reject itself already happened (via
 * `rejectProposal`, reason `null`) the instant the GM pressed reject, so the queue never
 * waits on a reason. Picking a chip a moment later attaches it here - a metadata-only
 * update (`reject_reason` is training signal for the ranker, not canon), guarded to apply
 * only to a proposal that is already rejected so this can never be used to sneak a reason
 * onto a pending or accepted row. A no-op (returns null) if the proposal is not rejected,
 * matching `rejectProposal`'s own "never re-ask" idempotency rather than throwing over a
 * stale toast the GM is slow to click. */
export async function setRejectReason(
	db: Db,
	proposalId: string,
	reason: string
): Promise<ProposalRow | null> {
	const [updated] = await db
		.update(proposal)
		.set({ rejectReason: reason })
		.where(and(eq(proposal.id, proposalId), eq(proposal.outcome, 'rejected')))
		.returning();
	return updated ?? null;
}

export class ProposalNotAcceptedError extends Error {
	constructor(proposalId: string, outcome: ProposalOutcome) {
		super(`proposal "${proposalId}" is not accepted (outcome: ${outcome}), nothing to undo`);
		this.name = 'ProposalNotAcceptedError';
	}
}

/** Thrown only for an 'update' accept whose target entity had no revision history before
 * this one - the seed fixture's shortcut (entities inserted without a founding revision),
 * never a real production entity, which always has at least the revision its own creation
 * wrote. There is nothing recorded to restore the entity to, so undo refuses rather than
 * guessing or leaving the proposal 'pending' over already-changed content. */
export class UndoNotPossibleError extends Error {
	constructor(proposalId: string) {
		super(
			`proposal "${proposalId}" has no revision recorded before its accept, so undo has nothing to restore to`
		);
		this.name = 'UndoNotPossibleError';
	}
}

export interface UndoAcceptedProposalInput {
	proposalId: string;
}

/** C6's few-seconds "fat-finger" undo toast, distinct from the general revision-history
 * revert the decision's own "days later" case still needs - that capability is not built
 * anywhere in this codebase yet and is out of scope here. Valid only while the proposal is
 * still 'accepted': for `update`, restores the entity to the revision immediately before
 * the `ai_accepted` one (found via `historyFor`'s ordering - the accepted revision itself
 * carries no `parentRevisionId` to read that from directly) and deletes that revision; for
 * `create`/`draft_entity`, deletes the entity the accept created outright, cascading its
 * one revision; for `relation`, deletes the relation row. Always flips the proposal back to
 * `pending` with its decision cleared, so it re-enters the queue exactly where it left it. */
export async function undoAcceptedProposal(
	db: Db,
	input: UndoAcceptedProposalInput
): Promise<ProposalRow> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(proposal)
			.where(eq(proposal.id, input.proposalId))
			.for('update')
			.limit(1);
		if (!existing) throw new ProposalNotFoundError(input.proposalId);
		if (existing.outcome !== 'accepted') {
			throw new ProposalNotAcceptedError(input.proposalId, existing.outcome);
		}

		if (existing.kind === 'update') {
			if (!existing.targetEntityId || !existing.appliedRevisionId) {
				throw new Error(
					`accepted 'update' proposal "${existing.id}" is missing its target entity or applied revision`
				);
			}
			const history = await tx
				.select()
				.from(revision)
				.where(eq(revision.entityId, existing.targetEntityId))
				.orderBy(desc(revision.createdAt));
			const acceptedIndex = history.findIndex((row) => row.id === existing.appliedRevisionId);
			const restoreTo = acceptedIndex >= 0 ? history[acceptedIndex + 1] : undefined;
			if (!restoreTo) throw new UndoNotPossibleError(existing.id);

			await tx
				.update(entity)
				.set({
					name: restoreTo.name,
					aliases: restoreTo.aliases,
					body: restoreTo.body,
					updatedAt: new Date()
				})
				.where(eq(entity.id, existing.targetEntityId));
			await tx.delete(revision).where(eq(revision.id, existing.appliedRevisionId));
		} else if (existing.kind === 'create' || existing.kind === 'draft_entity') {
			if (!existing.appliedRevisionId) {
				throw new Error(
					`accepted '${existing.kind}' proposal "${existing.id}" has no applied revision`
				);
			}
			// Issue #613: the entity this accept created is about to go, and a relation
			// proposal that resolved onto it would go with it, silently, through the
			// endpoint FK's cascade. Put the endpoint back to waiting instead, which is
			// exactly what it was a moment before this proposal was accepted, so C6's
			// few-seconds undo leaves the queue where it found it. Before the delete, so
			// the row is no longer pointing at the entity when the cascade runs.
			await unresolveRelationEndpoints(tx, existing.id);
			const [createdRevision] = await tx
				.select({ entityId: revision.entityId })
				.from(revision)
				.where(eq(revision.id, existing.appliedRevisionId))
				.limit(1);
			if (createdRevision) {
				await tx.delete(entity).where(eq(entity.id, createdRevision.entityId));
			}
		} else if (existing.kind === 'relation') {
			if (!existing.relationTypeId || !existing.targetEntityId || !existing.relatedEntityId) {
				throw new Error(
					`accepted 'relation' proposal "${existing.id}" is missing relationTypeId, targetEntityId or relatedEntityId`
				);
			}
			await tx
				.delete(relation)
				.where(
					and(
						eq(relation.relationTypeId, existing.relationTypeId),
						eq(relation.fromEntityId, existing.targetEntityId),
						eq(relation.toEntityId, existing.relatedEntityId)
					)
				);
		} else {
			throw new Error(`undoAcceptedProposal: unhandled proposal kind "${existing.kind}"`);
		}

		const [updated] = await tx
			.update(proposal)
			.set({ outcome: 'pending', decidedAt: null, decidedBy: null, appliedRevisionId: null })
			.where(eq(proposal.id, existing.id))
			.returning();
		if (!updated) throw new Error('undoAcceptedProposal: update returned no row');

		// Issue #508: the undo puts the candidate back in the queue, so the plan owes its
		// price again. This is the only path that raises the estimate, and it exists because
		// the accept above lowered it: a column that only ever falls would leave a plan that
		// was accepted and undone claiming less than it is going to spend.
		if (existing.planId) await shiftPlanEstimate(tx, existing.planId, 1);
		return updated;
	});
}

/**
 * Issue #164: the entity id `undoAcceptedProposal` is about to delete for an accepted
 * `create`/`draft_entity` proposal, resolved *before* the undo runs so a caller can clean
 * up anything keyed on that entity (its lore chunks in Qdrant, packages/indexing's
 * `deleteEntityLoreChunks`) once the undo has actually committed. Null for every other
 * kind, for a proposal that is not currently `accepted`, or for the slug-collision fold
 * (`foldCreateProposalOntoExistingSlug`) where the applied revision landed on an entity
 * that already existed rather than one this accept created.
 */
export async function entityDeletedByUndo(db: Db, proposalId: string): Promise<string | null> {
	const [existing] = await db.select().from(proposal).where(eq(proposal.id, proposalId)).limit(1);
	if (!existing) return null;
	if (existing.outcome !== 'accepted') return null;
	if (existing.kind !== 'create' && existing.kind !== 'draft_entity') return null;
	if (existing.targetEntityId || !existing.appliedRevisionId) return null;
	const [createdRevision] = await db
		.select({ entityId: revision.entityId })
		.from(revision)
		.where(eq(revision.id, existing.appliedRevisionId))
		.limit(1);
	return createdRevision?.entityId ?? null;
}
