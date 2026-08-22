/**
 * E1 = B: table mode is a mode this whole subtree renders, not a drawer over the wiki.
 * Every page under /table shares the running `session_context`, its instant-lane pins
 * (#73) and each pin's warm status (#73's card, sharing E2's warm/warming/cold vocabulary
 * with the material #77's triggers pre-compute) - loaded once here so every child page and
 * the persistent context strip agree on one snapshot per request.
 */
import { latestArtifact, pinnedNeighbors, runningSessionContext } from '@canonry/db';
import { isAmbientPackPayload } from '$lib/server/ambient-pack.js';
import { db } from '$lib/server/db';
import { requireTableAccess } from './_server/guard.js';
import { briefStatusFrom, pinCardsFor } from './_server/pin-cards.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const access = await requireTableAccess(event);
	const conn = db();

	const context = await runningSessionContext(conn, access.universe.id);

	const pinStart = performance.now();
	const pins = context?.placeEntityId ? await pinnedNeighbors(conn, context.placeEntityId) : [];
	const pinnedElapsedMs = Math.round((performance.now() - pinStart) * 100) / 100;

	// #477: shared with the declare route (`context/+server.ts`) and its SSE broadcast,
	// so a pin never reaches the client without the `warm` field the card reads.
	const pinCards = await pinCardsFor(conn, access.universe.id, pins);

	// #529: the place panel's own brief - the same warm `brief` artifact a pin reads,
	// subject to the place's own entity id rather than a neighbor's. `briefStatusFrom` is
	// what keeps "missing" and "stale but still shown" the same vocabulary as every pin row.
	const placeBrief = context?.placeEntityId
		? briefStatusFrom(
				await latestArtifact(conn, {
					universeId: access.universe.id,
					kind: 'brief',
					subjectEntityId: context.placeEntityId
				})
			)
		: null;

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
	// `w/[universe]/ambient/[id]` only once the GM actually presses play, so declaring a
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
		placeBrief,
		places,
		sessions,
		ambientPack
	};
};
