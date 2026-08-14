/**
 * SPEC.md §4.5 and §8. The DB-layer half of the warm cache: raw reads and writes against
 * `warm_artifact` and `session_context`, plus the graph reads that feed both. Fingerprint
 * computation and the five triggers' policy (what to warm, in what order, within what
 * budget) live in @canonry/warm, which calls the functions here - this file never decides
 * *whether* to regenerate anything, only stores and reads what it is told to.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType, WarmArtifactKind } from '../schema/enums.js';
import { relation, relationType } from '../schema/relation.js';
import { revision } from '../schema/revision.js';
import { sessionContext, warmArtifact } from '../schema/table.js';

export type WarmArtifactRow = typeof warmArtifact.$inferSelect;
export type SessionContextRow = typeof sessionContext.$inferSelect;

// ---------------------------------------------------------------------------------------
// Fingerprint sources: entity revision ids
// ---------------------------------------------------------------------------------------

/** The latest revision id per entity, which is what a fingerprint is built from (entity
 * revision ids + prompt version + model id, per SPEC §4.5). An entity with no revision row
 * yet (nothing has been through the revise path for it) maps to `null` rather than being
 * omitted, so a caller building a fingerprint over a fixed set of source entities always
 * gets one entry back per id it asked for. One round trip regardless of how many entity
 * ids are asked for, via `DISTINCT ON` picking each entity's newest row. */
export async function latestRevisionIds(
	db: Db,
	entityIds: string[]
): Promise<Map<string, string | null>> {
	const result = new Map<string, string | null>();
	for (const id of entityIds) result.set(id, null);
	if (entityIds.length === 0) return result;

	const rows = await db
		.selectDistinctOn([revision.entityId], { entityId: revision.entityId, revisionId: revision.id })
		.from(revision)
		.where(inArray(revision.entityId, entityIds))
		.orderBy(revision.entityId, desc(revision.createdAt));

	for (const row of rows) result.set(row.entityId, row.revisionId);
	return result;
}

// ---------------------------------------------------------------------------------------
// warm_artifact
// ---------------------------------------------------------------------------------------

function subjectPredicate(subjectEntityId: string | null) {
	return subjectEntityId === null
		? isNull(warmArtifact.subjectEntityId)
		: eq(warmArtifact.subjectEntityId, subjectEntityId);
}

/** Issue #76's "a lookup that is a single indexed query": an exact match on the same
 * columns as `warm_artifact_fingerprint_key` (kind, subject_entity_id, fingerprint), which
 * the unique index covers directly - this never scans. Used both to detect "we already
 * generated exactly this" (idempotent regeneration) and by `putArtifact`'s race backstop. */
export async function findByFingerprint(
	db: Db,
	input: { kind: WarmArtifactKind; subjectEntityId: string | null; fingerprint: string }
): Promise<WarmArtifactRow | null> {
	const rows = await db
		.select()
		.from(warmArtifact)
		.where(
			and(
				eq(warmArtifact.kind, input.kind),
				subjectPredicate(input.subjectEntityId),
				eq(warmArtifact.fingerprint, input.fingerprint)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

/** Whatever currently sits in this (kind, subject) slot, fresh or stale, or null if it has
 * never been generated. This is what lazy invalidation compares a freshly computed
 * fingerprint against: a mismatch means "mark stale", never "regenerate now". */
export async function latestArtifact(
	db: Db,
	input: { universeId: string; kind: WarmArtifactKind; subjectEntityId: string | null }
): Promise<WarmArtifactRow | null> {
	const rows = await db
		.select()
		.from(warmArtifact)
		.where(
			and(
				eq(warmArtifact.universeId, input.universeId),
				eq(warmArtifact.kind, input.kind),
				subjectPredicate(input.subjectEntityId)
			)
		)
		.orderBy(desc(warmArtifact.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

/** Stores a freshly generated artifact. Non-null subjects are protected by the unique
 * index; losing a race against a concurrent identical regeneration is not an error, it
 * just means the winner's row is returned instead of a duplicate. A null subject (a
 * ring-spanning context pack with no single anchor entity) has no such backstop, because
 * Postgres never treats two nulls as equal in a unique index - callers with a null subject
 * are expected to have already checked `findByFingerprint` themselves. */
export async function putArtifact(
	db: Db,
	input: {
		universeId: string;
		kind: WarmArtifactKind;
		subjectEntityId: string | null;
		payload: unknown;
		fingerprint: string;
		credits: number;
	}
): Promise<WarmArtifactRow> {
	try {
		const [row] = await db
			.insert(warmArtifact)
			.values({
				universeId: input.universeId,
				kind: input.kind,
				subjectEntityId: input.subjectEntityId,
				payload: input.payload,
				fingerprint: input.fingerprint,
				credits: input.credits,
				stale: false
			})
			.returning();
		if (!row) throw new Error('putArtifact: insert returned no row');
		return row;
	} catch (error) {
		const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
		const isUniqueViolation =
			cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505';
		if (input.subjectEntityId !== null && isUniqueViolation) {
			const existing = await findByFingerprint(db, input);
			if (existing) return existing;
		}
		throw error;
	}
}

/** Lazy invalidation's write half (SPEC §8.1): flips `stale` without touching payload or
 * fingerprint, and without regenerating anything. A no-op if it is already stale, so
 * repeated freshness checks against the same drifted artifact do not keep writing. */
export async function markStale(db: Db, artifactId: string): Promise<void> {
	await db
		.update(warmArtifact)
		.set({ stale: true })
		.where(and(eq(warmArtifact.id, artifactId), eq(warmArtifact.stale, false)));
}

/** SPEC §14's warm hit rate is consumed-over-generated; this is the "consumed" half. */
export async function recordConsumption(db: Db, artifactId: string): Promise<void> {
	await db
		.update(warmArtifact)
		.set({ consumedCount: sql`${warmArtifact.consumedCount} + 1`, lastConsumedAt: new Date() })
		.where(eq(warmArtifact.id, artifactId));
}

/** Trigger 5 (nightly): what is currently marked stale for a universe, oldest first so a
 * budget-limited run clears the longest-waiting drift before the most recent. */
export async function staleArtifacts(db: Db, universeId: string): Promise<WarmArtifactRow[]> {
	return db
		.select()
		.from(warmArtifact)
		.where(and(eq(warmArtifact.universeId, universeId), eq(warmArtifact.stale, true)))
		.orderBy(asc(warmArtifact.createdAt));
}

// ---------------------------------------------------------------------------------------
// session_context
// ---------------------------------------------------------------------------------------

export interface DeclareSessionContextInput {
	universeId: string;
	placeEntityId?: string | null;
	sessionEntityId?: string | null;
	moment?: string;
	situation?: string;
}

/** SPEC §8 / issue #72: the GM declares where the party is. `session_context_running_key`
 * enforces "exactly one running context per universe" at the schema level; this function
 * is the application half of that guarantee, ending whichever context was running (if any)
 * in the same transaction that starts the new one, so the invariant holds even for the
 * caller that only ever calls `declareSessionContext` and never `endSessionContext`
 * directly. */
export async function declareSessionContext(
	db: Db,
	input: DeclareSessionContextInput
): Promise<SessionContextRow> {
	return db.transaction(async (tx) => {
		await tx
			.update(sessionContext)
			.set({ endedAt: new Date() })
			.where(and(eq(sessionContext.universeId, input.universeId), isNull(sessionContext.endedAt)));

		const [row] = await tx
			.insert(sessionContext)
			.values({
				universeId: input.universeId,
				placeEntityId: input.placeEntityId ?? null,
				sessionEntityId: input.sessionEntityId ?? null,
				moment: input.moment ?? '',
				situation: input.situation ?? ''
			})
			.returning();
		if (!row) throw new Error('declareSessionContext: insert returned no row');
		return row;
	});
}

/** The one context §8 says everything else reads, or null between sessions. */
export async function runningSessionContext(
	db: Db,
	universeId: string
): Promise<SessionContextRow | null> {
	const rows = await db
		.select()
		.from(sessionContext)
		.where(and(eq(sessionContext.universeId, universeId), isNull(sessionContext.endedAt)))
		.limit(1);
	return rows[0] ?? null;
}

/** Closes the running context (the table breaks), if there is one. */
export async function endSessionContext(
	db: Db,
	universeId: string
): Promise<SessionContextRow | null> {
	const [row] = await db
		.update(sessionContext)
		.set({ endedAt: new Date() })
		.where(and(eq(sessionContext.universeId, universeId), isNull(sessionContext.endedAt)))
		.returning();
	return row ?? null;
}

// ---------------------------------------------------------------------------------------
// Instant lane: the 2-hop graph query
// ---------------------------------------------------------------------------------------

export interface PinnedNeighbor {
	entity: { id: string; name: string; type: EntityType; slug: string };
	hopDistance: number;
	via: { relationLabel: string; entityId: string; entityName: string } | null;
}

/** SPEC §8's instant lane: "pins the main characters of that place (a 2-hop graph query,
 * instant lane)". One round trip - a recursive CTE walks `relation` in either direction up
 * to `hops` steps from `placeEntityId`, then joins `entity` and `relation_type` once for
 * the whole result. `hopDistance` is the *shortest* path length to each neighbor (a node
 * reachable both at hop 1 and hop 2 is reported once, at hop 1), and `via` names the edge
 * that reaches it along that shortest path, for a UI that wants to say why an NPC is
 * pinned rather than just that it is. */
export async function pinnedNeighbors(
	db: Db,
	placeEntityId: string,
	opts?: { hops?: number }
): Promise<PinnedNeighbor[]> {
	const hops = opts?.hops ?? 2;
	const rows = await db.execute<{
		entity_id: string;
		name: string;
		type: EntityType;
		slug: string;
		hop_distance: number;
		relation_label: string | null;
		via_entity_id: string | null;
		via_entity_name: string | null;
	}>(sql`
		with recursive ring as (
			select ${placeEntityId}::uuid as entity_id, 0 as depth,
				null::uuid as relation_id, null::uuid as via_entity_id
			union all
			select
				case when r.from_entity_id = ring.entity_id then r.to_entity_id else r.from_entity_id end,
				ring.depth + 1,
				r.id,
				ring.entity_id
			from ${relation} r
			join ring on r.from_entity_id = ring.entity_id or r.to_entity_id = ring.entity_id
			where ring.depth < ${hops}
		),
		nearest as (
			select distinct on (entity_id) entity_id, depth, relation_id, via_entity_id
			from ring
			where entity_id <> ${placeEntityId}::uuid
			order by entity_id, depth asc
		)
		select
			e.id as entity_id, e.name, e.type, e.slug,
			nearest.depth as hop_distance,
			case when r.from_entity_id = nearest.via_entity_id then rt.label else rt.inverse_label end as relation_label,
			via.id as via_entity_id, via.name as via_entity_name
		from nearest
		join ${entity} e on e.id = nearest.entity_id
		left join ${relation} r on r.id = nearest.relation_id
		left join ${relationType} rt on rt.id = r.relation_type_id
		left join ${entity} via on via.id = nearest.via_entity_id
		order by nearest.depth asc, e.name asc
	`);

	return rows.map((row) => ({
		entity: { id: row.entity_id, name: row.name, type: row.type, slug: row.slug },
		hopDistance: Number(row.hop_distance),
		via:
			row.via_entity_id && row.relation_label
				? {
						relationLabel: row.relation_label,
						entityId: row.via_entity_id,
						entityName: row.via_entity_name ?? ''
					}
				: null
	}));
}

// ---------------------------------------------------------------------------------------
// Trigger 5 (nightly): which universes were active recently
// ---------------------------------------------------------------------------------------

/** "Nightly, only universes active in the last N days" (SPEC §8.1). Active means a canon
 * edit or a played session in the window - a universe that only had its price catalogue
 * read does not count. Two narrow scans unioned rather than one join, because a universe
 * can qualify by either signal alone. */
export async function activeUniverseIds(db: Db, sinceDays: number): Promise<string[]> {
	// Interpolated as an ISO string rather than a bare Date: `db.execute`'s raw sql tag
	// does not run the same value serialization the query builder applies to a typed
	// timestamp column, and postgres.js parses an ISO 8601 string into timestamptz fine.
	const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
	const rows = await db.execute<{ universe_id: string }>(sql`
		select distinct universe_id from (
			select universe_id from ${revision} where created_at >= ${cutoff}::timestamptz
			union
			select universe_id from ${sessionContext} where started_at >= ${cutoff}::timestamptz
		) as active
	`);
	return rows.map((row) => row.universe_id);
}
