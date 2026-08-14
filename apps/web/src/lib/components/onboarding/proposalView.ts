/**
 * Issue #108. Client-safe read helpers for a proposal row in D2 = B's live feed and D7's
 * "first accept" screen. proposal.patch is jsonb (unknown to drizzle, and empty `{}` for a
 * relation kind - see packages/import/src/job-runner.ts's own comment on why relation
 * candidates never get a recordProposalDiff call), so every read here is defensive rather
 * than an assertion of a shape nothing here validated.
 */

export interface ProposalSummary {
	id: string;
	kind: 'create' | 'update' | 'relation' | 'draft_entity' | 'flag';
	patch: unknown;
	rationale: string;
	outcome: 'pending' | 'accepted' | 'rejected' | 'superseded';
	decidedAt: string | null;
	createdAt: string;
}

// Import never produces a 'flag' proposal (that is audit mode's own kind, SPEC.md §5.2) -
// listed anyway so this map stays exhaustive against proposal_kind rather than needing a
// fallback branch nothing here can otherwise reach.
const KIND_BADGE: Record<ProposalSummary['kind'], string> = {
	create: 'new',
	update: 'update',
	relation: 'relation',
	draft_entity: 'draft',
	flag: 'flag'
};

export function proposalBadge(proposal: ProposalSummary): string {
	return KIND_BADGE[proposal.kind];
}

function patchName(patch: unknown): string | null {
	if (typeof patch !== 'object' || patch === null) return null;
	const name = (patch as Record<string, unknown>).name;
	return typeof name === 'string' && name.length > 0 ? name : null;
}
export function proposalDisplayName(proposal: ProposalSummary): string {
	const fromPatch = patchName(proposal.patch);
	if (fromPatch) return fromPatch;
	return proposal.rationale.length > 0 ? proposal.rationale : 'Untitled proposal';
}
