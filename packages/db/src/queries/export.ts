import { count, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType, EntityVisibility } from '../schema/enums.js';
import { universe } from '../schema/universe.js';

export interface UniverseExportMeta {
	id: string;
	name: string;
	slug: string;
}

export interface ExportEntityRow {
	name: string;
	type: EntityType;
	aliases: string[];
	slug: string;
	visibility: EntityVisibility;
	body: string;
	createdAt: Date;
	updatedAt: Date;
}

/** Rows fetched per round trip to Postgres while streaming an export. Large enough that a
 * thousand-entity universe still only takes a handful of fetches, small enough that one
 * batch in memory is never the bottleneck a whole-universe `select` would be. */
const EXPORT_CURSOR_BATCH_SIZE = 200;

/** Issue #21: the universe a slug names, or undefined if none exists. This is export's
 * only read of the universe table; the README it feeds needs the name, and the route
 * needs the id to scope the entity stream below. */
export async function universeForExport(
	db: Db,
	slug: string
): Promise<UniverseExportMeta | undefined> {
	const rows = await db
		.select({ id: universe.id, name: universe.name, slug: universe.slug })
		.from(universe)
		.where(eq(universe.slug, slug))
		.limit(1);
	return rows[0];
}

/** Issue #21: how many files the export's README should say it contains. A cheap count
 * query kept separate from `streamEntitiesForExport` below, so the README can report an
 * accurate total without the caller having to buffer the streamed rows first just to
 * count them. */
export async function countEntitiesForExport(db: Db, universeId: string): Promise<number> {
	const rows = await db
		.select({ total: count() })
		.from(entity)
		.where(eq(entity.universeId, universeId));
	return rows[0]?.total ?? 0;
}

/** Issue #21 acceptance: one row per entity, one file the caller writes into the zip per
 * row. Reads through `db.$client` (postgres.js) directly rather than drizzle's query
 * builder because only postgres.js exposes a server-side cursor here: `.cursor()` opens
 * an implicit transaction and `FETCH`es `EXPORT_CURSOR_BATCH_SIZE` rows at a time, so a
 * universe with thousands of entries never sits in Node memory all at once - only the
 * batch currently in flight does. `apps/web/src/lib/server/export.ts` consumes this
 * generator and writes each entity straight into a streaming zip entry as it arrives.
 *
 * Reads `entity.body` and nothing from `revision`: the entity row is already exactly
 * what's canon (guardrail 1 - nothing else ever writes it), which is also what F4's
 * "rejected outright" list requires: an export must never carry an unaccepted proposal.
 * Ordered by slug, which is also each file's name, so two exports of an unchanged
 * universe list identically. */
export async function* streamEntitiesForExport(
	db: Db,
	universeId: string
): AsyncGenerator<ExportEntityRow> {
	const client = db.$client;
	const query = client<
		{
			name: string;
			type: EntityType;
			aliases: string[];
			slug: string;
			visibility: EntityVisibility;
			body: string;
			// `db.$client` is the raw postgres.js client drizzle wraps; drizzle disables its
			// automatic Date parsing so its own query builder can do the mapping, which means
			// a tagged-template query run straight off `$client` (as this one is) gets the
			// driver's unparsed text form back for timestamptz, not a Date.
			created_at: string;
			updated_at: string;
		}[]
	>`
		select name, type, aliases, slug, visibility, body, created_at, updated_at
		from entity
		where universe_id = ${universeId}
		order by slug
	`;
	for await (const rows of query.cursor(EXPORT_CURSOR_BATCH_SIZE)) {
		for (const row of rows) {
			yield {
				name: row.name,
				type: row.type,
				aliases: row.aliases,
				slug: row.slug,
				visibility: row.visibility,
				body: row.body,
				createdAt: new Date(row.created_at),
				updatedAt: new Date(row.updated_at)
			};
		}
	}
}
