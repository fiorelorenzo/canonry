/**
 * Issue #75: instant lane first, fast lane only when the exact match misses. `?q=` is the
 * query; `?type=` narrows it (the context-declaration control uses this to search places
 * only). The response always says which lane answered, so a "who is this" card can render
 * differently for an instant hit versus a fast-lane one and never claim a vector match is
 * an exact name.
 */
import { json } from '@sveltejs/kit';
import { instantSearch, fastLaneSearch } from '../_server/search.js';
import {
	tableEmbeddingApiToken,
	tableGatewayCredentials,
	tableVectorClient
} from '../_server/deps.js';
import { requireTableAccess } from '../_server/guard.js';
import { db } from '$lib/server/db';
import type { EntityType } from '@canonry/db/schema';
import type { RequestHandler } from './$types';

const VALID_TYPES = new Set<EntityType>([
	'character',
	'place',
	'faction',
	'item',
	'event',
	'session'
]);

function parsedType(raw: string | null): EntityType | undefined {
	return raw && VALID_TYPES.has(raw as EntityType) ? (raw as EntityType) : undefined;
}

export const GET: RequestHandler = async (event) => {
	const access = await requireTableAccess(event);
	const q = event.url.searchParams.get('q') ?? '';
	const type = parsedType(event.url.searchParams.get('type'));

	const conn = db();
	const start = performance.now();
	const instant = await instantSearch(conn, access.universe.id, q, { type });
	const instantElapsedMs = Math.round((performance.now() - start) * 100) / 100;

	if (instant.length > 0 || q.trim().length === 0) {
		return json({ lane: 'instant', hits: instant, elapsedMs: instantElapsedMs });
	}

	const fastStart = performance.now();
	const fast = await fastLaneSearch(
		{
			db: conn,
			userId: access.userId,
			qdrant: tableVectorClient(),
			gatewayCredentials: tableGatewayCredentials,
			embeddingApiToken: tableEmbeddingApiToken,
			locale: event.locals.locale
		},
		access.universe.id,
		q
	);
	const fastElapsedMs = Math.round((performance.now() - fastStart) * 100) / 100;

	return json({ ...fast, instantElapsedMs, fastElapsedMs });
};
