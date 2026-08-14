/**
 * E1 = B: table mode is a mode this whole subtree renders, not a drawer over the wiki.
 * Every page under /table shares the running `session_context`, its instant-lane pins
 * (#73) and each pin's warm status (#73's card, sharing E2's warm/warming/cold vocabulary
 * with the material #77's triggers pre-compute) - loaded once here so every child page and
 * the persistent context strip agree on one snapshot per request.
 */
import { latestArtifact, pinnedNeighbors, runningSessionContext } from '@canonry/db';
import { isAmbientPackPayload } from '$lib/server/ambient-pack.js';
import type { PinCard } from '$lib/components/table/types';
import { db } from '$lib/server/db';
import { requireTableAccess } from './_server/guard.js';
import type { LayoutServerLoad } from './$types';

/** `warm_artifact.payload` is opaque jsonb (@canonry/db never interprets it, matches
 * proposal.evidence's own convention) - `'text' in payload` is a real runtime check, not an
 * inline cast, so a payload shaped some other way just renders no preview text rather than
 * throwing. */
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

export const load: LayoutServerLoad = async (event) => {
	const access = await requireTableAccess(event);
	const conn = db();

	const context = await runningSessionContext(conn, access.universe.id);

	const pinStart = performance.now();
	const pins = context?.placeEntityId ? await pinnedNeighbors(conn, context.placeEntityId) : [];
	const pinnedElapsedMs = Math.round((performance.now() - pinStart) * 100) / 100;

	// One warm-status lookup per pin, all indexed on (universe_id, kind, subject_entity_id) -
	// still well inside the instant lane even at a dozen pins, and each is a read of
	// whatever #77's triggers have already computed, never a generation of its own.
	const pinCards: PinCard[] = await Promise.all(
		pins.map(async (pin) => {
			const artifact = await latestArtifact(conn, {
				universeId: access.universe.id,
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

	// The declaration control's candidate list (decision E1's #72 lock-in: "an autocomplete
	// over place-typed entities", never a free-text box). Small by construction - most
	// universes hold a few dozen places at most - so listing them outright rather than
	// requiring a keystroke first is the honest instant-lane behaviour.
	const [places, sessions] = await Promise.all([
		conn.query.entity.findMany({
			where: (entity, { and, eq }) =>
				and(eq(entity.universeId, access.universe.id), eq(entity.type, 'place')),
			columns: { id: true, name: true, slug: true },
			orderBy: (entity, { asc }) => asc(entity.name),
			limit: 50
		}),
		conn.query.entity.findMany({
			where: (entity, { and, eq }) =>
				and(eq(entity.universeId, access.universe.id), eq(entity.type, 'session')),
			columns: { id: true, name: true, slug: true },
			orderBy: (entity, { desc }) => desc(entity.updatedAt),
			limit: 20
		})
	]);

	const placeEntity = context?.placeEntityId
		? (places.find((p) => p.id === context.placeEntityId) ?? null)
		: null;
	const sessionEntity = context?.sessionEntityId
		? (sessions.find((s) => s.id === context.sessionEntityId) ?? null)
		: null;

	// Issue #69: the declared place's most recent ambient pack, if one has ever been
	// generated for it - summary only (id, description, layer count), never the layers
	// themselves. `AmbientPlayer.svelte` fetches the full layer list from
	// `u/[universe]/ambient/[id]` only once the GM actually presses play, so declaring a
	// place that already has a pack costs one indexed lookup here, not a fetch of every
	// layer's bytes.
	const ambientArtifact = context?.placeEntityId
		? await latestArtifact(conn, {
				universeId: access.universe.id,
				kind: 'ambient_pack',
				subjectEntityId: context.placeEntityId
			})
		: null;
	const ambientPack =
		ambientArtifact && isAmbientPackPayload(ambientArtifact.payload)
			? {
					id: ambientArtifact.id,
					description: ambientArtifact.payload.description,
					layerCount: ambientArtifact.payload.layers.length,
					stale: ambientArtifact.stale
				}
			: null;

	return {
		universeId: access.universe.id,
		universeSlug: access.universe.slug,
		universeName: access.universe.name,
		userId: access.userId,
		role: access.role,
		context: context
			? {
					id: context.id,
					placeEntityId: context.placeEntityId,
					placeName: placeEntity?.name ?? null,
					sessionEntityId: context.sessionEntityId,
					sessionName: sessionEntity?.name ?? null,
					moment: context.moment,
					situation: context.situation,
					startedAt: context.startedAt.toISOString()
				}
			: null,
		pins: pinCards,
		pinnedElapsedMs,
		places,
		sessions,
		ambientPack
	};
};
