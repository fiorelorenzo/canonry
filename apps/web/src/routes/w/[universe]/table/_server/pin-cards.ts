/**
 * #477: the one place that turns `pinnedNeighbors`'s `PinnedNeighbor[]` (nested `entity`,
 * no warm status - that query has no idea what a "brief" artifact is) into the
 * `PinCard[]` shape `PinnedCards.svelte` actually reads (flat `entityId`/`name`/`type`/
 * `slug`, plus `warm`). `+layout.server.ts` had this right for the initial page load;
 * `context/+server.ts`'s declare route built its own `pinned` mapping by hand and never
 * added the `warm` field, so a pin declared over that route - and the identical object it
 * broadcasts over SSE as the `context` event's `pinned` - reached `PinnedCards.svelte`
 * with `pin.warm` simply absent. `{#if pin.warm.status === 'warm'}` then throws
 * `Cannot read properties of undefined (reading 'status')` the instant a GM declares a
 * place, which is every time E2's progressive-arrival lane is exercised for real. One
 * shared builder is what stops the two call sites drifting apart again.
 */
import { latestArtifact, type Db, type PinnedNeighbor } from '@canonry/db';
import type { PinCard } from '$lib/components/table/types';

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

/** One warm-status lookup per pin, all indexed on (universe_id, kind, subject_entity_id) -
 * still well inside the instant lane even at a dozen pins, and each is a read of whatever
 * #77's triggers have already computed, never a generation of its own. */
export async function pinCardsFor(
	db: Db,
	universeId: string,
	pins: PinnedNeighbor[]
): Promise<PinCard[]> {
	return Promise.all(
		pins.map(async (pin) => {
			const artifact = await latestArtifact(db, {
				universeId,
				kind: 'brief',
				subjectEntityId: pin.entity.id
			});
			const warm: PinCard['warm'] =
				artifact && !artifact.stale
					? {
							status: 'warm',
							updatedAt: artifact.createdAt.toISOString(),
							text: briefTextOf(artifact.payload)
						}
					: { status: 'cold', lastWarmedAt: artifact ? artifact.createdAt.toISOString() : null };
			return {
				entityId: pin.entity.id,
				name: pin.entity.name,
				type: pin.entity.type,
				slug: pin.entity.slug,
				hopDistance: pin.hopDistance,
				via: pin.via
					? { relationLabel: pin.via.relationLabel, entityName: pin.via.entityName }
					: null,
				warm
			};
		})
	);
}
