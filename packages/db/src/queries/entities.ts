/**
 * SPEC.md §17 / issue #122: `entity.language` is detected at write time, overridable by the
 * GM, and null when it is unknown or genuinely mixed - and a GM's explicit choice, including
 * that null "not sure / mixed" answer, is sticky forever. `entity.languageSource` is what
 * makes that possible (migration 0020): a 'detected' row is free to change on every save,
 * including down to null when an edit makes the body shorter or genuinely mixed, while a
 * 'human' row is never touched by detection again, because re-guessing a value the GM
 * already set is a fight with the software rather than a helpful default.
 *
 * Issue #145 (I7 = C, "one page, two modes") adds the browser this file never had: a
 * type-scoped, recency-sorted list plus per-type counts for the filter row, and
 * `createEntity` for the browser's "New entry" dialog. `createEntity` deliberately writes
 * nothing to `revision` - guardrail 2's one write path (`saveEntityBody`) is what a body
 * actually landing in canon goes through, and a freshly created entity has no body yet.
 * The dialog's whole job is establishing a name, a type and therefore a slug, then handing
 * off to the real editor at `/e/[slug]/edit`, which already calls `saveEntityBody` and
 * `scheduleCanonSaveJob` on its own first save - no second write path invented here.
 */
import { count, eq, sql } from 'drizzle-orm';
import { detectLanguage, toLocale, type Locale } from '@canonry/lang';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import { fact } from '../schema/fact.js';
import { relation } from '../schema/relation.js';
import { revision } from '../schema/revision.js';
import type { EntityType, LanguageSource } from '../schema/enums.js';

export interface EntityLanguageState {
	language: Locale | null;
	languageSource: LanguageSource;
}

function slugifyEntityName(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.length > 0 ? base : 'entry';
}

export type EntityRow = typeof entity.$inferSelect;

export interface CreateEntityInput {
	universeId: string;
	type: EntityType;
	name: string;
}

/** The browser's "New entry" dialog (I7 = C): the smallest honest write that gets a GM
 * from a name and a type to a slug they can open in the real editor. Mirrors
 * `createWork`'s bounded-suffix slug loop, namespaced the same way `entity`'s own unique
 * index is (`entity_universe_slug_key`), for the same reason: two characters both named
 * "Aldric" is a GM typing the same name twice, not a race worth a bare insert-and-catch. */
export async function createEntity(db: Db, input: CreateEntityInput): Promise<EntityRow> {
	const base = slugifyEntityName(input.name);
	let slug = base;
	for (let suffix = 2; suffix < 100; suffix += 1) {
		const existing = await db.query.entity.findFirst({
			where: (row, { and, eq: eqOp }) =>
				and(eqOp(row.universeId, input.universeId), eqOp(row.slug, slug))
		});
		if (!existing) break;
		slug = `${base}-${suffix}`;
	}

	const [row] = await db
		.insert(entity)
		.values({ universeId: input.universeId, type: input.type, name: input.name, slug })
		.returning();
	if (!row) throw new Error('createEntity: insert did not return a row');
	return row;
}

export interface EntityBrowserRow {
	id: string;
	name: string;
	type: EntityType;
	slug: string;
	excerpt: string;
	updatedAt: Date;
	/** O2 (#284), read by O1's home cards (#283): the entry's chosen cover, or null. A
	 * caller turns it into `/w/<slug>/e/<entry>/media/<id>`; nothing here knows a URL. */
	coverAssetId: string | null;
}

export interface ListEntitiesOptions {
	type?: EntityType;
	limit?: number;
}

const BROWSER_EXCERPT_LENGTH = 160;

function browserExcerpt(body: string): string {
	const firstParagraph = (body.split('\n\n')[0] ?? '').trim();
	return firstParagraph.length > BROWSER_EXCERPT_LENGTH
		? `${firstParagraph.slice(0, BROWSER_EXCERPT_LENGTH)}…`
		: firstParagraph;
}

/** I7 = C's browser with no search box in play: every entry in a universe (or every entry
 * of one filtered type), newest change first (the decided default sort - a ranked-by-
 * staleness sort was rejected in the artifact as a model's judgment steering what a GM
 * reads before they've read anything). `searchEntitiesByNameOrAlias` (`table-search.ts`)
 * is the other half, for when there is a query to rank against. */
export async function listEntitiesForUniverse(
	db: Db,
	universeId: string,
	opts?: ListEntitiesOptions
): Promise<EntityBrowserRow[]> {
	const rows = await db.query.entity.findMany({
		where: (row, { and, eq: eqOp }) =>
			opts?.type
				? and(eqOp(row.universeId, universeId), eqOp(row.type, opts.type))
				: eqOp(row.universeId, universeId),
		orderBy: (row, { desc }) => desc(row.updatedAt),
		limit: opts?.limit ?? 500,
		columns: {
			id: true,
			name: true,
			slug: true,
			type: true,
			body: true,
			updatedAt: true,
			coverAssetId: true
		}
	});
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		slug: row.slug,
		excerpt: browserExcerpt(row.body),
		updatedAt: row.updatedAt,
		coverAssetId: row.coverAssetId
	}));
}

/** O1 = C (#283): which column the entry table is sorted by. Exactly the five columns the
 * table draws, so a header is the only thing that can order it - a hidden sixth order
 * (search relevance, say) would make the caret in the header a lie about what a reader is
 * looking at. */
export type EntityBrowserSort = 'name' | 'type' | 'relations' | 'facts' | 'changed';

export interface EntityBrowserPageOptions {
	type?: EntityType;
	/** Narrows by name or alias, the same substring predicate `searchEntitiesByNameOrAlias`
	 * uses. It filters and never reorders: see `EntityBrowserSort`. */
	query?: string;
	sort?: EntityBrowserSort;
	direction?: 'asc' | 'desc';
	/** Page size. */
	limit?: number;
	offset?: number;
}

export interface EntityBrowserPageRow extends EntityBrowserRow {
	/** Both directions of `relation`, which is how the relations panel counts them too:
	 * one stored row is one relationship, read from either end. */
	relationCount: number;
	factCount: number;
}

export interface EntityBrowserPage {
	rows: EntityBrowserPageRow[];
	/** Rows matching `type` and `query`, ignoring `limit`/`offset` - the denominator the
	 * table's footer divides into pages. Counted rather than inferred from `rows.length`,
	 * so an offset past the end still reports the true total instead of zero. */
	total: number;
}

const ORDER_BY: Record<EntityBrowserSort, { asc: string; desc: string }> = {
	// Ordering on the output alias rather than repeating each expression: Postgres allows
	// it, and the alternative is writing the two count subqueries twice each.
	name: { asc: 'lower(e.name) asc', desc: 'lower(e.name) desc' },
	type: { asc: 'e.type asc', desc: 'e.type desc' },
	relations: { asc: 'relation_count asc', desc: 'relation_count desc' },
	facts: { asc: 'fact_count asc', desc: 'fact_count desc' },
	changed: { asc: 'e.updated_at asc', desc: 'e.updated_at desc' }
};

/**
 * O1 = C (#283): the entry browser at `/w/<slug>/entries`, with the pagination the flat
 * list never had. The page this replaces took up to 500 rows and drew no pages, which was
 * already wrong for a world bigger than the sample one and becomes a visible lie the moment
 * a footer says "page 1 of 3".
 *
 * The two counts are correlated subqueries rather than joins: a `group by` over a join to
 * `relation` and `fact` at once multiplies the rows of one by the other before counting,
 * and getting that right needs two separate aggregates anyway. Both read an indexed column
 * (`relation`'s unique index on the type/from/to triple and `fact_entity_id_...`'s fk).
 */
export async function entityBrowserPage(
	db: Db,
	universeId: string,
	opts?: EntityBrowserPageOptions
): Promise<EntityBrowserPage> {
	const q = opts?.query?.trim() ?? '';
	const typeFilter = opts?.type ? sql`and e.type = ${opts.type}` : sql``;
	const queryFilter = q
		? sql`and (
				e.name ilike ${'%' + q + '%'}
				or exists (select 1 from unnest(e.aliases) a where a ilike ${'%' + q + '%'})
			)`
		: sql``;
	const where = sql`where e.universe_id = ${universeId} ${typeFilter} ${queryFilter}`;
	const order = ORDER_BY[opts?.sort ?? 'changed'][opts?.direction ?? 'desc'];
	const limit = opts?.limit ?? 25;
	const offset = opts?.offset ?? 0;

	const [rows, totals] = await Promise.all([
		db.execute<{
			id: string;
			name: string;
			type: EntityType;
			slug: string;
			body: string;
			// `db.execute`'s raw sql tag skips the query builder's type mapping, so
			// timestamptz comes back as text and the counts as strings (bigint).
			updated_at: string;
			cover_asset_id: string | null;
			relation_count: string;
			fact_count: string;
		}>(sql`
			select
				e.id, e.name, e.type, e.slug, e.body, e.updated_at, e.cover_asset_id,
				(
					select count(*) from ${relation} r
					where r.from_entity_id = e.id or r.to_entity_id = e.id
				) as relation_count,
				(select count(*) from ${fact} f where f.entity_id = e.id) as fact_count
			from ${entity} e
			${where}
			order by ${sql.raw(order)}, lower(e.name) asc, e.id asc
			limit ${limit} offset ${offset}
		`),
		db.execute<{ total: string }>(sql`
			select count(*) as total from ${entity} e
			${where}
		`)
	]);

	return {
		rows: rows.map((row) => ({
			id: row.id,
			name: row.name,
			type: row.type,
			slug: row.slug,
			excerpt: browserExcerpt(row.body),
			updatedAt: new Date(row.updated_at),
			coverAssetId: row.cover_asset_id,
			relationCount: Number(row.relation_count),
			factCount: Number(row.fact_count)
		})),
		total: Number(totals[0]?.total ?? 0)
	};
}

/** The filter row's "real counts", per entity type actually present - never a hardcoded
 * five-entry map, since a universe missing a type (no items yet) should show a real zero,
 * not silently drop the chip. */
export async function entityCountsByType(
	db: Db,
	universeId: string
): Promise<Partial<Record<EntityType, number>>> {
	const rows = await db
		.select({ type: entity.type, count: count() })
		.from(entity)
		.where(eq(entity.universeId, universeId))
		.groupBy(entity.type);
	const counts: Partial<Record<EntityType, number>> = {};
	for (const row of rows) counts[row.type] = row.count;
	return counts;
}

export interface EntityLanguageState {
	language: Locale | null;
	languageSource: LanguageSource;
}

/** What a caller reads off the `entity` row: `language` is a plain `text` column at the
 * schema level (drizzle has no way to know it only ever holds a `Locale`), so this is
 * `toLocale`-narrowed here rather than trusted at every call site. */
export interface StoredEntityLanguage {
	language: string | null;
	languageSource: LanguageSource;
}

/**
 * The pure decision, kept separate from any I/O so it is trivial to unit-test: a 'human'
 * row passes through untouched (narrowed, never re-guessed), a 'detected' row is replaced
 * by whatever the heuristic says right now (including null, which is an honest downgrade,
 * not a bug).
 */
export function nextEntityLanguage(
	current: StoredEntityLanguage,
	body: string
): EntityLanguageState {
	if (current.languageSource === 'human') {
		return { language: toLocale(current.language), languageSource: 'human' };
	}
	return { language: detectLanguage(body), languageSource: 'detected' };
}

/**
 * The accept-time counterpart to `nextEntityLanguage`, for guardrail 1's own writer
 * (`acceptProposal`, `packages/db/src/queries/proposals.ts`): an import's per-document
 * detection (`patch.language`, a signal read over the whole source document rather than a
 * short merged entity summary) is more reliable than re-running the heuristic over the
 * patch's own body, so it wins when present. Still never touches a 'human' row, and still
 * falls back to `detectLanguage` on the resulting body when the patch carries nothing.
 */
export function languageFromAcceptedPatch(
	current: StoredEntityLanguage,
	patchLanguage: string | undefined,
	body: string
): EntityLanguageState {
	if (current.languageSource === 'human') {
		return { language: toLocale(current.language), languageSource: 'human' };
	}
	return { language: toLocale(patchLanguage) ?? detectLanguage(body), languageSource: 'detected' };
}

export interface SaveEntityBodyInput {
	universeId: string;
	entityId: string;
	entityName: string;
	entityAliases: string[];
	parentRevisionId?: string;
	authorUserId: string;
	body: string;
	/** The entity's language state before this save, so detection can refuse to run over a
	 * human's choice. Callers already have this from the row they loaded to get here. */
	current: StoredEntityLanguage;
}

export interface SaveEntityBodyResult extends EntityLanguageState {
	revisionId: string;
}

/**
 * The one write path for a human edit to an entry's body: a `revision` row and the
 * entity's own body move together (issue #86, guardrail 2), and `entity.language` is
 * recomputed in the same transaction so nothing ever reads a committed entity whose
 * language disagrees with the body that produced it.
 */
export async function saveEntityBody(
	db: Db,
	input: SaveEntityBodyInput
): Promise<SaveEntityBodyResult> {
	const next = nextEntityLanguage(input.current, input.body);
	return db.transaction(async (tx) => {
		const [rev] = await tx
			.insert(revision)
			.values({
				universeId: input.universeId,
				entityId: input.entityId,
				parentRevisionId: input.parentRevisionId,
				authorKind: 'human',
				authorUserId: input.authorUserId,
				name: input.entityName,
				aliases: input.entityAliases,
				body: input.body
			})
			.returning({ id: revision.id });
		if (!rev) throw new Error('revision insert returned no row');
		await tx
			.update(entity)
			.set({
				body: input.body,
				language: next.language,
				languageSource: next.languageSource,
				updatedAt: new Date()
			})
			.where(eq(entity.id, input.entityId));
		return { revisionId: rev.id, ...next };
	});
}

/**
 * The GM's explicit choice from the entry's own language control, including "not sure /
 * mixed" (`language: null`) - always recorded as 'human', so it is never revisited by a
 * later save's detection pass.
 */
export async function setEntityLanguage(
	db: Db,
	input: { entityId: string; language: Locale | null }
): Promise<EntityLanguageState> {
	const next: EntityLanguageState = { language: input.language, languageSource: 'human' };
	await db
		.update(entity)
		.set({ language: next.language, languageSource: next.languageSource })
		.where(eq(entity.id, input.entityId));
	return next;
}

/**
 * "Auto-detect" on the control: reverts a human override back to automatic and, rather than
 * leaving a stale value sitting under the new 'detected' provenance until the entry's next
 * save, immediately re-runs the heuristic against the body as it stands right now.
 */
export async function resetEntityLanguageToDetected(
	db: Db,
	input: { entityId: string }
): Promise<EntityLanguageState> {
	const [current] = await db
		.select({ body: entity.body })
		.from(entity)
		.where(eq(entity.id, input.entityId));
	if (!current) throw new Error(`entity ${input.entityId} does not exist`);
	const next: EntityLanguageState = {
		language: detectLanguage(current.body),
		languageSource: 'detected'
	};
	await db
		.update(entity)
		.set({ language: next.language, languageSource: next.languageSource })
		.where(eq(entity.id, input.entityId));
	return next;
}

/**
 * O2 (#284): the one function anywhere that writes `entity.cover_asset_id`, kept alone the
 * same way `setMediaAssetGmOnly` is the only writer of `media_asset.gm_only` and for the
 * same reason. "Use as cover" in the Images panel is an accept (guardrail 1): a picture
 * a model generated becomes the entry's face because a person pressed something that says
 * so, so there must be exactly one place that write can come from, and no code path may
 * reach it as a side effect of generating, attaching, uploading or marking gm_only.
 *
 * `mediaAssetId: null` clears the cover, which is the same deliberate act in reverse rather
 * than a separate undo surface. Whether the asset belongs to this entry, and whether it is
 * an image at all, is the caller's check: this module only reads and writes Postgres.
 */
export async function setEntityCover(
	db: Db,
	input: { entityId: string; mediaAssetId: string | null }
): Promise<{ coverAssetId: string | null }> {
	const [updated] = await db
		.update(entity)
		.set({ coverAssetId: input.mediaAssetId })
		.where(eq(entity.id, input.entityId))
		.returning({ coverAssetId: entity.coverAssetId });
	if (!updated) throw new Error(`entity ${input.entityId} does not exist`);
	return updated;
}
