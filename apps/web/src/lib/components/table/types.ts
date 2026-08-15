/**
 * Shared shapes between the table subtree's server loads/routes and its components,
 * mirroring `$lib/components/shell/types.ts`'s own reason for existing: a component
 * should not reach into a route file's exports for a type, and a server load should not
 * duplicate what the component that renders it already declares.
 */
import type { EntitySearchHit } from '@canonry/db';
import type { EntityType, ProposalKind } from '@canonry/db/schema';

export interface PinCard {
	entityId: string;
	name: string;
	type: EntityType;
	slug: string;
	hopDistance: number;
	via: { relationLabel: string; entityName: string } | null;
	warm:
		| { status: 'warm'; updatedAt: string; text: string | null }
		| { status: 'cold'; lastWarmedAt: string | null };
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
