/**
 * SPEC.md §8 / issue #75: "the instant lane means an indexed query on names and aliases
 * rather than a vector search". `entity_aliases_gin_idx` already covers the alias array;
 * name matching runs against the same small per-universe row set (`entity_universe_slug_key`
 * narrows by `universe_id` first), which is what keeps this under the instant lane's 100 ms
 * without a dedicated name index - most universes are dozens to a few hundred entries, not
 * the scale where a sequential scan inside one universe stops being instant.
 *
 * Ranking is exact name match, then name prefix, then exact alias, then alias prefix, then
 * substring anywhere in either - so "who is this" answers with the most literal reading of
 * what the GM typed first, the same discipline `entity_source_ref` matching (SPEC.md §6.4)
 * applies to string normalisation: a cheap, deterministic pre-filter, never a guess.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType } from '../schema/enums.js';

export interface EntitySearchHit {
	id: string;
	name: string;
	type: EntityType;
	slug: string;
	aliases: string[];
	/** The alias that matched, when the match came from an alias rather than the name -
	 * "who is this" wants to say *why* a hit surfaced ("aka Gilded Rat Tavern"), not just
	 * that it did. */
	matchedAlias: string | null;
	/** First ~160 characters of the entry body, for a search result that has to answer
	 * "who is this" without a click. */
	excerpt: string;
	/** Issue #145: the browser's search mode still shows "changed 2d ago" per row, same as
	 * its unfiltered listing. */
	updatedAt: Date;
}

export interface SearchEntitiesOptions {
	/** Narrows to one entity type - the context-declaration autocomplete searches places
	 * only, "who is this" searches every type. */
	type?: EntityType;
	limit?: number;
}

const EXCERPT_LENGTH = 160;

function excerptOf(body: string): string {
	const trimmed = body.trim();
	if (trimmed.length <= EXCERPT_LENGTH) return trimmed;
	return `${trimmed.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

/** SPEC.md §8's instant lane, issue #75's exact ask: an indexed query on names and aliases,
 * not a vector search. Empty query returns no rows rather than "everything" - the caller
 * (autocomplete or the fast-lane fallback trigger) decides what an empty box means. */
export async function searchEntitiesByNameOrAlias(
	db: Db,
	universeId: string,
	query: string,
	opts?: SearchEntitiesOptions
): Promise<EntitySearchHit[]> {
	const q = query.trim();
	if (!q) return [];
	const limit = opts?.limit ?? 8;
	const typeFilter = opts?.type ? sql`and e.type = ${opts.type}` : sql``;

	const rows = await db.execute<{
		id: string;
		name: string;
		type: EntityType;
		slug: string;
		aliases: string[];
		body: string;
		matched_alias: string | null;
		rank: number;
		// `db.execute`'s raw sql tag skips the query builder's own type mapping (see
		// `activeUniverseIds`'s comment in `warm.ts`), so timestamptz comes back as text.
		updated_at: string;
	}>(sql`
		select
			e.id, e.name, e.type, e.slug, e.aliases, e.body, e.updated_at,
			(
				select a from unnest(e.aliases) a
				where a ilike ${q + '%'}
				order by (lower(a) = lower(${q})) desc, length(a) asc
				limit 1
			) as matched_alias,
			case
				when lower(e.name) = lower(${q}) then 0
				when e.name ilike ${q + '%'} then 1
				when exists (select 1 from unnest(e.aliases) a where lower(a) = lower(${q})) then 2
				when exists (select 1 from unnest(e.aliases) a where a ilike ${q + '%'}) then 3
				else 4
			end as rank
		from ${entity} e
		where e.universe_id = ${universeId}
			${typeFilter}
			and (
				e.name ilike ${'%' + q + '%'}
				or exists (select 1 from unnest(e.aliases) a where a ilike ${'%' + q + '%'})
			)
		order by rank asc, e.name asc
		limit ${limit}
	`);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		slug: row.slug,
		aliases: row.aliases,
		matchedAlias: row.matched_alias,
		excerpt: excerptOf(row.body),
		updatedAt: new Date(row.updated_at)
	}));
}
