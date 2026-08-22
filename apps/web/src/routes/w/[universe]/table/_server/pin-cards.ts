/**
 * #477: the one place that turns `pinnedNeighbors`'s `PinnedNeighbor[]` (nested `entity`,
 * no warm status - that query has no idea what a "brief" artifact is) into the
 * `PinCard[]` shape `PinnedCards.svelte` and `TableDeck.svelte` actually read (flat
 * `entityId`/`name`/`type`/`slug`, plus `warm` and `hasPendingProposal`). `+layout.server.ts`
 * had this right for the initial page load; `context/+server.ts`'s declare route built its
 * own `pinned` mapping by hand and never added the `warm` field, so a pin declared over that
 * route - and the identical object it broadcasts over SSE as the `context` event's `pinned` -
 * reached the client with `pin.warm` simply absent. One shared builder is what stops the two
 * call sites drifting apart again.
 *
 * #529: `warm` used to collapse "never generated" and "stale" into one `cold` status and
 * discard the text either way - a brief a GM already paid for, sitting one edit behind, went
 * dark on a card the moment its fingerprint drifted. `briefStatusFrom` is the fix: an artifact
 * that exists, fresh or stale, always keeps its text; `missing` is reserved for the one case
 * that has never generated anything to show. `+layout.server.ts` reuses it for the declared
 * place's own brief, so the place panel and every pin row agree on one vocabulary.
 */
import { latestArtifact, type Db, type PinnedNeighbor, type WarmArtifactRow } from '@canonry/db';
import type { BriefStatus, PinCard } from '$lib/components/table/types';

/** `warm_artifact.payload` is opaque jsonb (@canonry/db never interprets it) - `'text' in
 * payload` is a real runtime check, not an inline cast, so a payload shaped some other way
 * just renders no preview text rather than throwing. */
function briefTextOf(payload: unknown): string | null {
	if (
		payload &&
		typeof payload === 'object' &&
		'text' in payload &&
		typeof payload.text === 'string'
	) {
		return payload.text;
	}
	return null;
}

/** Shared between a pin's own brief and the declared place's own brief: `null` (no artifact
 * has ever been generated for this subject) is `missing`; any artifact, stale or not, is
 * `ready` and always carries whatever text it has. */
export function briefStatusFrom(artifact: WarmArtifactRow | null): BriefStatus {
	if (!artifact) return { status: 'missing' };
	return { status: 'ready', text: briefTextOf(artifact.payload), stale: artifact.stale };
}

/** One warm-status lookup per pin, all indexed on (universe_id, kind, subject_entity_id) -
 * still well inside the instant lane even at a dozen pins, and each is a read of whatever
 * #77's triggers have already computed, never a generation of its own. The pending-proposal
 * check is one indexed query (`proposal_universe_outcome_idx`) over every pin at once rather
 * than one round trip per pin. */
export async function pinCardsFor(
	db: Db,
	universeId: string,
	pins: PinnedNeighbor[]
): Promise<PinCard[]> {
	const pendingRows =
		pins.length === 0
			? []
			: await db.query.proposal.findMany({
					where: (proposal, { and, eq, inArray }) =>
						and(
							eq(proposal.universeId, universeId),
							eq(proposal.outcome, 'pending'),
							inArray(
								proposal.targetEntityId,
								pins.map((pin) => pin.entity.id)
							)
						),
					columns: { targetEntityId: true }
				});
	const pendingTargetIds = new Set(
		pendingRows.map((row) => row.targetEntityId).filter((id): id is string => id !== null)
	);

	return Promise.all(
		pins.map(async (pin) => {
			const artifact = await latestArtifact(db, {
				universeId,
				kind: 'brief',
				subjectEntityId: pin.entity.id
			});
			return {
				entityId: pin.entity.id,
				name: pin.entity.name,
				type: pin.entity.type,
				slug: pin.entity.slug,
				hopDistance: pin.hopDistance,
				via: pin.via
					? { relationLabel: pin.via.relationLabel, entityName: pin.via.entityName }
					: null,
				warm: briefStatusFrom(artifact),
				hasPendingProposal: pendingTargetIds.has(pin.entity.id)
			};
		})
	);
}
