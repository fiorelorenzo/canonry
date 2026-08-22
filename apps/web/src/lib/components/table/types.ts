/**
 * Shared shapes between the table subtree's server loads/routes and its components,
 * mirroring `$lib/components/shell/types.ts`'s own reason for existing: a component
 * should not reach into a route file's exports for a type, and a server load should not
 * duplicate what the component that renders it already declares.
 */
import type { EntitySearchHit } from '@canonry/db';
import type { EntityType, ProposalKind } from '@canonry/db/schema';

/** #529: an artifact that exists, fresh or stale, always carries its text; `missing` is the
 * one case with nothing to show yet. Shared between a pin's own brief and the declared
 * place's own brief (`table/_server/pin-cards.ts`'s `briefStatusFrom`). */
export type BriefStatus =
	{ status: 'ready'; text: string | null; stale: boolean } | { status: 'missing' };

export interface PinCard {
	entityId: string;
	name: string;
	type: EntityType;
	slug: string;
	hopDistance: number;
	via: { relationLabel: string; entityName: string } | null;
	warm: BriefStatus;
	/** #529: a pin whose entity has a pending (undecided) proposal against it - the board's
	 * "who is here" row and the deck both say so rather than leaving it silent. */
	hasPendingProposal: boolean;
}

export interface TableContext {
	id: string;
	placeEntityId: string | null;
	placeName: string | null;
	sessionEntityId: string | null;
	sessionName: string | null;
	moment: string;
	situation: string;
	startedAt: string;
}

export interface EntityRef {
	id: string;
	name: string;
	slug: string;
}

export interface ProposalSummary {
	proposalId: string;
	kind?: ProposalKind;
	rationale?: string;
	targetEntityId?: string;
	targetName?: string;
	preview?: string;
	/** A stable id, not a display phrase - `+page.svelte`'s own `actionLabel` looks up the
	 * locale-appropriate label (`table.actionLabels`), so the same tap never freezes an
	 * English phrase into an SSE event a different locale later renders. */
	via: 'npc-here' | 'create-child-location' | 'quick-note';
	drafted?: 'model' | 'scaffold';
	unavailableReason?: string | null;
}

export interface FastLaneHit {
	title: string;
	url: string;
	breadcrumb: string;
	score: number;
	excerpt: string;
}

export type SearchHit = EntitySearchHit | FastLaneHit;
