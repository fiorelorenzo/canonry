/**
 * Issue #73/#72: "the GM declares context, which sets session_context and the instant lane
 * pins the place's main characters." One POST, one round trip: `declareContextAndPin`
 * (packages/warm) writes `session_context` and runs the 2-hop graph query in the same call,
 * and the response carries the server-measured elapsed time so the client renders the real
 * number rather than a promise about it (decision E2 rejects any promised timing).
 */
import { json } from '@sveltejs/kit';
import { declareContextAndPin } from '@canonry/warm';
import { db } from '$lib/server/db';
import { publishTableEvent } from '$lib/server/table-stream';
import { requireTableAccess } from '../_server/guard.js';
import { pinCardsFor } from '../_server/pin-cards.js';
import type { RequestHandler } from './$types';

interface DeclareBody {
	placeEntityId?: string | null;
	sessionEntityId?: string | null;
	moment?: string;
	situation?: string;
}

function isDeclareBody(value: unknown): value is DeclareBody {
	return typeof value === 'object' && value !== null;
}

export const POST: RequestHandler = async (event) => {
	const access = await requireTableAccess(event);
	const raw: unknown = await event.request.json().catch(() => ({}));
	const body = isDeclareBody(raw) ? raw : {};

	const conn = db();
	const start = performance.now();
	const { context, pinned } = await declareContextAndPin(conn, {
		universeId: access.universe.id,
		placeEntityId: body.placeEntityId ?? null,
		sessionEntityId: body.sessionEntityId ?? null,
		moment: body.moment ?? '',
		situation: body.situation ?? ''
	});
	const elapsedMs = Math.round((performance.now() - start) * 100) / 100;

	const payload = {
		context: {
			id: context.id,
			placeEntityId: context.placeEntityId,
			sessionEntityId: context.sessionEntityId,
			moment: context.moment,
			situation: context.situation,
			startedAt: context.startedAt.toISOString()
		},
		// #477: `declareContextAndPin` returns the raw `PinnedNeighbor[]` shape, not the
		// `PinCard[]` `PinnedCards.svelte` reads - a hand-rolled map here once left the
		// `warm` field off both this response and the SSE `context` event it broadcasts
		// below, so the very declare that fills the lane made it throw. Shared with
		// `+layout.server.ts`'s initial load so the two can't drift apart again.
		pinned: await pinCardsFor(conn, access.universe.id, pinned),
		elapsedMs
	};

	publishTableEvent(access.universe.id, 'context', payload);

	return json(payload);
};
