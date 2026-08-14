// SPEC.md §4.4, §5.1, guardrail 1. This module is the exclusive writer of canon from a
// proposal - "nothing else in the codebase may write canon from a proposal" - so every
// path that turns a proposal's outcome into a change lives here, in one transaction each,
// never split across a caller and this file.
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
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
import { relation } from '../schema/relation.js';
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

function isEmptyPatch(patch: unknown): boolean {
	return (
		typeof patch === 'object' &&
		patch !== null &&
		!Array.isArray(patch) &&
		Object.keys(patch).length === 0
	);
}

export interface CreateProposalPlanCandidate {
	kind: ProposalKind;
	targetEntityId: string | null;
	relationTypeId?: string | null;
	relatedEntityId?: string | null;
	rationale: string;
	/** Shape is the writer's (packages/copilot's `CandidateEvidence[]` for propagation) -
	 * this module never interprets it, only stores and returns it. */
	evidence: unknown;
	rank: number;
}

export interface CreateProposalPlanInput {
	universeId: string;
	trigger: ProposalTrigger;
	triggerEntityId?: string | null;
	triggerRevisionId?: string | null;
	summary: string;
	candidateCap: number;
	estimatedCredits: number;
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
					patch: {},
					rationale: candidate.rationale,
					evidence: candidate.evidence,
					rank: candidate.rank,
					outcome: 'pending' as const
				}))
			)
			.returning();

		return { plan, proposals };
	});
}

export interface DropCandidateResult {
	plan: ProposalPlanRow;
	dropped: ProposalRow;
}

/** decision C3: the GM can drop an entry from the plan before any diff is generated.
 * Recomputes `proposal_plan.estimated_credits` down by whatever `propagate.diff` currently
 * costs, so the estimate a GM sees always reflects what is actually left to spend. */
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

		const [plan] = await tx
			.select()
			.from(proposalPlan)
			.where(eq(proposalPlan.id, existing.planId))
			.for('update')
			.limit(1);
		if (!plan) throw new ProposalPlanNotFoundError(existing.planId);

		const [priceRow] = await tx
			.select({ credits: operationPrice.credits })
			.from(operationPrice)
			.where(eq(operationPrice.operation, 'propagate.diff'))
			.limit(1);
		const perEntryCredits = priceRow?.credits ?? 0;
		const newEstimate = Math.max(0, plan.estimatedCredits - perEntryCredits);

		const [updatedPlan] = await tx
			.update(proposalPlan)
			.set({ estimatedCredits: newEstimate })
			.where(eq(proposalPlan.id, plan.id))
			.returning();
		if (!updatedPlan) throw new Error('dropCandidateFromPlan: update returned no plan row');

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
	return result;
}

interface EntityCreatePatchShape {
	type: EntityType;
	name: string;
	slug: string;
	aliases: string[];
	body: string;
}

function readEntityCreatePatch(patch: unknown): EntityCreatePatchShape {
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
	return { type: type as EntityType, name, slug, aliases, body };
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
 * sees `outcome: 'accepted'` and returns without writing a second revision. */
export async function acceptProposal(db: Db, input: AcceptProposalInput): Promise<ProposalRow> {
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
			const [entityRow] = await tx
				.select()
				.from(entity)
				.where(eq(entity.id, existing.targetEntityId))
				.for('update')
				.limit(1);
			if (!entityRow) {
				throw new Error(
					`proposal "${existing.id}" targets missing entity "${existing.targetEntityId}"`
				);
			}

			const patch = readEntityUpdatePatch(existing.patch);
			const nextName = patch.name ?? entityRow.name;
			const nextAliases = patch.aliases ?? entityRow.aliases;
			const nextBody = patch.after ?? entityRow.body;

			const [rev] = await tx
				.insert(revision)
				.values({
					universeId: existing.universeId,
					entityId: existing.targetEntityId,
					authorKind: 'ai_accepted',
					proposalId: existing.id,
					name: nextName,
					aliases: nextAliases,
					body: nextBody
				})
				.returning();
			if (!rev) throw new Error('acceptProposal: revision insert returned no row');
			appliedRevisionId = rev.id;

			await tx
				.update(entity)
				.set({ name: nextName, aliases: nextAliases, body: nextBody, updatedAt: new Date() })
				.where(eq(entity.id, existing.targetEntityId));
		} else if (existing.kind === 'create' || existing.kind === 'draft_entity') {
			const patch = readEntityCreatePatch(existing.patch);
			const [createdEntity] = await tx
				.insert(entity)
				.values({
					universeId: existing.universeId,
					type: patch.type,
					name: patch.name,
					slug: patch.slug,
					aliases: patch.aliases,
					body: patch.body
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
		} else if (existing.kind === 'relation') {
			if (!existing.relationTypeId || !existing.targetEntityId || !existing.relatedEntityId) {
				throw new Error(
					`proposal "${existing.id}" is kind 'relation' but is missing relationTypeId, targetEntityId or relatedEntityId`
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
		return updated;
	});
}
