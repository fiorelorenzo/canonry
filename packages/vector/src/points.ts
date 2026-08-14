/**
 * Generic point storage (SPEC.md §11.3). Collection-name agnostic on purpose: a
 * per-universe lore collection (`lore.ts`) is one caller, but any other collection - a
 * similarity cache keyed on something other than a universe, for instance - upserts and
 * queries through the exact same functions.
 */
import type { QdrantClient } from '@qdrant/js-client-rest';

export interface VectorPoint {
	id: string;
	vector: number[];
	payload: Record<string, unknown>;
}

/** A hand-named subset of Qdrant's filter language covering exact-match `must`/`must_not`
 * conditions - the only shape every caller in this codebase needs so far (SPEC.md §11.3's
 * mandatory `universe_id` filter, issue #62's data-source/url matches). Extend this shape
 * (or take a raw Qdrant filter object) if a future caller needs `should`, ranges or
 * nested filters - Qdrant's own filter type supports all of it, only the ergonomic
 * wrapper here is deliberately narrow. */
export interface VectorFilterCondition {
	key: string;
	value: string | number | boolean;
}

export interface VectorFilter {
	must?: VectorFilterCondition[];
	mustNot?: VectorFilterCondition[];
}

function toQdrantFilter(filter: VectorFilter): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (filter.must?.length) {
		out.must = filter.must.map((c) => ({ key: c.key, match: { value: c.value } }));
	}
	if (filter.mustNot?.length) {
		out.must_not = filter.mustNot.map((c) => ({ key: c.key, match: { value: c.value } }));
	}
	return out;
}

/** Upserts points; a no-op on an empty batch rather than a wasted round trip. `wait: true`
 * so a caller's very next query against the same points is guaranteed to see them - the
 * idempotency check in packages/indexing (issue #58) reads its own writes. */
export async function upsertPoints(
	client: QdrantClient,
	collectionName: string,
	points: VectorPoint[]
): Promise<void> {
	if (points.length === 0) return;
	await client.upsert(collectionName, {
		wait: true,
		points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload }))
	});
}

export interface VectorQuery {
	vector: number[];
	filter?: VectorFilter;
	limit?: number;
	scoreThreshold?: number;
}

export interface VectorHit {
	id: string;
	score: number;
	payload: Record<string, unknown>;
}

export async function queryPoints(
	client: QdrantClient,
	collectionName: string,
	query: VectorQuery
): Promise<VectorHit[]> {
	const response = await client.query(collectionName, {
		query: query.vector,
		...(query.filter ? { filter: toQdrantFilter(query.filter) } : {}),
		limit: query.limit ?? 10,
		...(query.scoreThreshold !== undefined ? { score_threshold: query.scoreThreshold } : {}),
		with_payload: true
	});
	return response.points.map((point) => ({
		id: String(point.id),
		score: point.score,
		payload: (point.payload ?? {}) as Record<string, unknown>
	}));
}

export async function deletePoints(
	client: QdrantClient,
	collectionName: string,
	filter: VectorFilter
): Promise<void> {
	await client.delete(collectionName, { wait: true, filter: toQdrantFilter(filter) });
}

export interface VectorRecord {
	id: string;
	payload: Record<string, unknown>;
}

/** Fetches points by filter without a vector search - used to check what is already
 * stored (packages/indexing's idempotency check, issue #58) rather than to rank
 * anything. */
export async function scrollPoints(
	client: QdrantClient,
	collectionName: string,
	params: { filter?: VectorFilter; limit?: number } = {}
): Promise<VectorRecord[]> {
	const response = await client.scroll(collectionName, {
		...(params.filter ? { filter: toQdrantFilter(params.filter) } : {}),
		limit: params.limit ?? 10,
		with_payload: true
	});
	return response.points.map((point) => ({
		id: String(point.id),
		payload: (point.payload ?? {}) as Record<string, unknown>
	}));
}

/** Exact point count matching `filter` (or the whole collection with no filter) - used to
 * report `data_source.chunk_count` accurately after an indexing run touches only some of
 * a source's pages. */
export async function countPoints(
	client: QdrantClient,
	collectionName: string,
	filter?: VectorFilter
): Promise<number> {
	const result = await client.count(collectionName, {
		...(filter ? { filter: toQdrantFilter(filter) } : {}),
		exact: true
	});
	return result.count;
}
