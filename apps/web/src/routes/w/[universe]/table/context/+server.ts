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
		pinned: pinned.map((pin) => ({
			entityId: pin.entity.id,
			name: pin.entity.name,
			type: pin.entity.type,
			slug: pin.entity.slug,
			hopDistance: pin.hopDistance,
			via: pin.via ? { relationLabel: pin.via.relationLabel, entityName: pin.via.entityName } : null
		})),
		elapsedMs
	};

	publishTableEvent(access.universe.id, 'context', payload);

	return json(payload);
};
