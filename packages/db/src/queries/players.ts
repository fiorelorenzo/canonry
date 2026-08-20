/**
 * SPEC.md §4.4 and §10, decisions E5 = C and E7 = C. Two halves:
 *
 * Write: `revealEntityLive` / `queueEntityForSessionLog` / `confirmSessionLog` (and their
 * fact/relation siblings) are the two paths issue #82's own comment names - "the live tap
 * actually publish for what the GM taps during play, plus a one-tap confirmation from the
 * phone before leaving the table for the remainder" - both landing in the one `revelation`
 * table, `confirmed_at` recording which path a row took. A row with `confirmed_at` null is
 * a queued candidate: it exists (the table did bring it up) but has not been confirmed into
 * the players' wiki yet, which is G7's answer to the timing problem the issue comment raises
 * - "live for what the GM taps, the log for everything else" is exactly the `confirmed_at
 * is not null` predicate every read below filters on.
 *
 * Read: `listPublicEntities` / `publicEntityBySlug` are the players' wiki itself - a join
 * on `revelation`, never a per-entry flag (SPEC.md §4.4), with `entity.visibility =
 * 'gm_only'` excluded unconditionally as a second, independent guard so a bug that ever
 * managed to write a revelation row for a gm_only entity still could not surface it
 * (guardrail 6, defense in depth). An entity that exists and is revealable but carries no
 * confirmed 'entity' revelation renders as E7's gap page: name and type only, nothing else,
 * which is why `publicEntityBySlug` returns a `PublicGapEntity` rather than a partially
 * filled `PublicFullEntity` with fields hidden by the caller.
 *
 * Secrets (#84) are half this file's concern, and the halves split where the data does.
 * `entity.body` here is the raw stored markdown, fences and all: stripping prose for players
 * is `apps/web/src/lib/server/players.ts`'s job, one layer up, because that is where the one
 * body a page renders passes through. A fact's `sourceExcerpt` cannot wait for that layer.
 * Its offsets index the body of `fact.source_revision_id`, a string no caller of this
 * function ever sees, so a caller has nothing to filter against and every caller would have
 * to remember to. #306: this file drops any revealed fact whose span is not wholly inside a
 * player-visible part of that source body, using `@canonry/lang`'s `isPlayerVisibleSpan` -
 * the same parser `stripSecretsForPlayers` runs on, so there is one definition of what a
 * fence hides rather than two that can drift.
 */
import { isPlayerVisibleSpan } from '@canonry/lang';
import { and, asc, desc, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType, EntityVisibility, MediaKind, RevelationKind } from '../schema/enums.js';
import { fact } from '../schema/fact.js';
import { mediaAsset } from '../schema/media.js';
import { revelation } from '../schema/players.js';
import { relation, relationType, relationTypeLabel } from '../schema/relation.js';
import { revision } from '../schema/revision.js';

// -----------------------------------------------------------------------------------------
// Write: marking something revealed
// -----------------------------------------------------------------------------------------

export interface RevelationRow {
	id: string;
	universeId: string;
	kind: RevelationKind;
	entityId: string | null;
	factId: string | null;
	relationId: string | null;
	sessionEntityId: string | null;
	confirmedAt: Date | null;
	confirmedBy: string | null;
	note: string;
	createdAt: Date;
}

interface RevealTarget {
	universeId: string;
	sessionEntityId: string;
	confirmedBy?: string | null;
	note?: string;
}

export type RevealEntityInput = RevealTarget & { entityId: string };
export type RevealFactInput = RevealTarget & { factId: string };
export type RevealRelationInput = RevealTarget & { relationId: string };

interface WriteRow {
	universeId: string;
	kind: RevelationKind;
	entityId: string | null;
	factId: string | null;
	relationId: string | null;
	sessionEntityId: string;
	confirmedBy: string | null;
	note: string;
}

function toRow(
	kind: RevelationKind,
	target: RevealEntityInput | RevealFactInput | RevealRelationInput
): WriteRow {
	return {
		universeId: target.universeId,
		kind,
		entityId: 'entityId' in target ? target.entityId : null,
		factId: 'factId' in target ? target.factId : null,
		relationId: 'relationId' in target ? target.relationId : null,
		sessionEntityId: target.sessionEntityId,
		confirmedBy: target.confirmedBy ?? null,
		note: target.note ?? ''
	};
}

/** Decision E5's live path: a one-tap flag during play that publishes to the players' wiki
 * immediately. Idempotent per the unique index on (target, session): a second live tap in
 * the same session, or live-tapping a row the session log already queued, only ever moves
 * `confirmed_at` forward from null to now - it never overwrites an earlier confirmation, so
 * calling this twice never changes when the players' wiki says something was learned. */
async function revealLiveRow(
	db: Db,
	row: WriteRow,
	conflictTarget: PgColumn[]
): Promise<RevelationRow> {
	const now = new Date();
	const [written] = await db
		.insert(revelation)
		.values({ ...row, confirmedAt: now })
		.onConflictDoUpdate({
			target: conflictTarget,
			set: {
				confirmedAt: sql`coalesce(${revelation.confirmedAt}, excluded.confirmed_at)`,
				confirmedBy: sql`coalesce(${revelation.confirmedBy}, excluded.confirmed_by)`
			}
		})
		.returning();
	if (!written) throw new Error('revealLive: insert returned no row');
	return written;
}

export async function revealEntityLive(db: Db, input: RevealEntityInput): Promise<RevelationRow> {
	return revealLiveRow(db, toRow('entity', input), [
		revelation.entityId,
		revelation.sessionEntityId
	]);
}

export async function revealFactLive(db: Db, input: RevealFactInput): Promise<RevelationRow> {
	return revealLiveRow(db, toRow('fact', input), [revelation.factId, revelation.sessionEntityId]);
}

export async function revealRelationLive(
	db: Db,
	input: RevealRelationInput
): Promise<RevelationRow> {
	return revealLiveRow(db, toRow('relation', input), [
		revelation.relationId,
		revelation.sessionEntityId
	]);
}

/** Decision E5's log path: something came up at the table without a live tap, queued as a
 * candidate for the session log the GM confirms after the table breaks. `confirmed_at`
 * stays null - not yet visible to players (G7) - until `confirmSessionLog` below runs. A
 * no-op against a row that already exists in any state, live-confirmed or already queued,
 * so queuing something twice never downgrades or duplicates it. */
async function queueRow(db: Db, row: WriteRow): Promise<void> {
	await db
		.insert(revelation)
		.values({ ...row, confirmedAt: null })
		.onConflictDoNothing();
}

export async function queueEntityForSessionLog(db: Db, input: RevealEntityInput): Promise<void> {
	await queueRow(db, toRow('entity', input));
}

export async function queueFactForSessionLog(db: Db, input: RevealFactInput): Promise<void> {
	await queueRow(db, toRow('fact', input));
}

export async function queueRelationForSessionLog(
	db: Db,
	input: RevealRelationInput
): Promise<void> {
	await queueRow(db, toRow('relation', input));
}

/** The GM's one-tap confirmation "before leaving the table" (#82's comment): every row
 * this session queued and never live-tapped becomes visible at once. Returns the rows it
 * confirmed, so a caller can show what just became visible. */
export async function confirmSessionLog(
	db: Db,
	input: { sessionEntityId: string; confirmedBy?: string | null }
): Promise<RevelationRow[]> {
	return db
		.update(revelation)
		.set({ confirmedAt: new Date(), confirmedBy: input.confirmedBy ?? null })
		.where(
			and(
				eq(revelation.sessionEntityId, input.sessionEntityId),
				sql`${revelation.confirmedAt} is null`
			)
		)
		.returning();
}

// -----------------------------------------------------------------------------------------
// Read: the players' wiki
// -----------------------------------------------------------------------------------------

export interface PublicMentionTarget {
	name: string;
	slug: string;
	aliases: string[];
}

/** The one definition of "is this entity's mention public". `publicMentionTargets`'s own
 * WHERE clause below is built from this constant rather than a second `'gm_only'` literal,
 * and `apps/web`'s `EntryProseWithSecrets.svelte` (#220, via `publicMentionTargetsFrom` in
 * `apps/web/src/lib/components/players/playerPreview.ts`) filters the GM route's own
 * unfiltered mention-target list through this same exported function before rendering its
 * player preview. One predicate instead of two rules that happen to agree today: a third
 * `entity_visibility` value would need this file to change once, not the GM route's query
 * and this query independently and hopefully in step. */
const GM_ONLY_VISIBILITY = 'gm_only' satisfies EntityVisibility;

export function isPubliclyVisible(visibility: EntityVisibility): boolean {
	return visibility !== GM_ONLY_VISIBILITY;
}

/** Every mention target a player-facing render is allowed to resolve against: every
 * `revealable` entity, gap or full alike (E7: a mention inside revealed prose is always a
 * real link, whether its destination fills in or not). `gm_only` entities are never in this
 * list, so a mention of one resolves exactly like a name nothing owns - unresolved, no
 * differential signal that it exists at all. */
export async function publicMentionTargets(
	db: Db,
	universeId: string
): Promise<PublicMentionTarget[]> {
	return db
		.select({ name: entity.name, slug: entity.slug, aliases: entity.aliases })
		.from(entity)
		.where(and(eq(entity.universeId, universeId), ne(entity.visibility, GM_ONLY_VISIBILITY)));
}

export interface RevealedEntityListItem {
	id: string;
	name: string;
	type: EntityType;
	slug: string;
	status: 'full' | 'gap';
	revealedAt: Date | null;
}

/** The players' wiki index: every `revealable` entity in the universe, `gm_only` excluded
 * entirely (not even as a name), each carrying whether it has a confirmed 'entity'
 * revelation. E7's gap page is reachable by browsing this list, not only by following a
 * mention out of already-revealed prose (see the E7 artifact's own cost note on option C). */
export async function listPublicEntities(
	db: Db,
	universeId: string
): Promise<RevealedEntityListItem[]> {
	const revealedAt = sql<Date | null>`max(${revelation.confirmedAt})`;
	const rows = await db
		.select({ id: entity.id, name: entity.name, type: entity.type, slug: entity.slug, revealedAt })
		.from(entity)
		.leftJoin(
			revelation,
			and(
				eq(revelation.entityId, entity.id),
				eq(revelation.kind, 'entity'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.where(and(eq(entity.universeId, universeId), ne(entity.visibility, 'gm_only')))
		.groupBy(entity.id)
		.orderBy(asc(entity.name));

	return rows.map((row) => ({
		...row,
		status: row.revealedAt ? 'full' : 'gap',
		// postgres.js only auto-decodes timestamptz for a plain column reference; a raw
		// `max(...)` aggregate comes back as the wire text form, not a parsed Date.
		revealedAt: row.revealedAt ? new Date(row.revealedAt as unknown as string) : null
	}));
}

export interface PublicGapEntity {
	status: 'gap';
	name: string;
	type: EntityType;
}

/** #306: a row here is a fact a player may read in full. A revealed fact whose evidence span
 * touches a `:::secret` or `:::gmnote` fence in its source revision has no row at all - not
 * the excerpt, and not the `statement` either, which is drawn from that same fenced sentence
 * and would republish it in paraphrase. Guardrail 3 wants a claim shown with its evidence,
 * so a claim whose evidence has to be withheld is withheld with it. */
export interface PublicFactRow {
	id: string;
	statement: string;
	spanStart: number;
	spanEnd: number;
	sourceExcerpt: string;
}

export interface PublicRelationRow {
	/** Stable identity (decision L1, #195) - display keys off this plus `direction`, never
	 * off `label`. */
	key: string;
	/** Perspective-resolved display word: the authored text, or #198's saved translation
	 * for the locale `publicEntityBySlug` was called with, when one exists - see this
	 * file's own comment on that function. The shipped ten still repaint from the i18n
	 * bundle by `key` regardless (#196); this field only carries the final word for a
	 * universe's own type. */
	label: string;
	direction: 'from' | 'to';
	other: { id: string; name: string; type: EntityType; slug: string; status: 'full' | 'gap' };
}

export interface PublicImageRow {
	id: string;
	kind: MediaKind;
}

export interface PublicFullEntity {
	status: 'full';
	id: string;
	name: string;
	type: EntityType;
	slug: string;
	aliases: string[];
	/** Raw stored markdown, secret and GM-note fences included - #83's caller in apps/web is
	 * responsible for running this through `@canonry/lang`'s `stripSecretsForPlayers` before
	 * it ever reaches a page's data. See this file's module doc. */
	body: string;
	revealedAt: Date;
	revealedInSession: string | null;
	facts: PublicFactRow[];
	relations: PublicRelationRow[];
	images: PublicImageRow[];
	/** O2 (#284): the entry's cover, or null. Guardrail 6 has no exception for images, so
	 * this is the entity's `cover_asset_id` only when that asset is one of `images` above,
	 * meaning it cleared the same published/gm_only/revelation gate every other picture on
	 * this page did. A cover a GM set but never published is null here, exactly as if the
	 * entry had none: `/p/<slug>` does not get to show unreviewed content because it
	 * happens to sit at the top of the document. */
	coverImageId: string | null;
}

export type PublicEntity = PublicFullEntity | PublicGapEntity;

const otherEntity = alias(entity, 'players_other_entity');
const sessionEntity = alias(entity, 'players_session_entity');

/** #83 acceptance and #85's contract: an entity that does not exist, or exists as
 * `gm_only`, returns undefined - a caller renders both identically (a plain 404), so
 * neither response distinguishes "never existed" from "exists but is the GM's". An entity
 * that exists and is revealable but carries no confirmed 'entity' revelation returns E7's
 * sparse gap shape: name and type, nothing else - no id, no aliases, no body, no facts, no
 * relations, no images, matching the E7 artifact's own lock-in list precisely. */
export async function publicEntityBySlug(
	db: Db,
	universeId: string,
	slug: string,
	locale?: string
): Promise<PublicEntity | undefined> {
	const [row] = await db
		.select()
		.from(entity)
		.where(
			and(
				eq(entity.universeId, universeId),
				eq(entity.slug, slug),
				ne(entity.visibility, 'gm_only')
			)
		)
		.limit(1);
	if (!row) return undefined;

	const [revealRow] = await db
		.select({ confirmedAt: revelation.confirmedAt, sessionName: sessionEntity.name })
		.from(revelation)
		.leftJoin(sessionEntity, eq(sessionEntity.id, revelation.sessionEntityId))
		.where(
			and(
				eq(revelation.entityId, row.id),
				eq(revelation.kind, 'entity'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.orderBy(desc(revelation.confirmedAt))
		.limit(1);

	if (!revealRow?.confirmedAt) {
		return { status: 'gap', name: row.name, type: row.type };
	}

	// The source body comes back whole rather than as a `substring()`, because the excerpt is
	// only safe to cut once something has parsed that body for fences (this file's own doc,
	// #306), and there is one parser for that, in JS. It costs the body of each revealed
	// fact's source revision per read, which is a handful of rows and a few kilobytes each on
	// the widest entry the fixture has. Slicing in JS also lines the excerpt up with how the
	// spans were produced: `packages/copilot` writes them with `String.prototype.indexOf` on
	// a JS string, so they count UTF-16 code units, while `substring()` counts characters -
	// the two disagree by one per astral character (an emoji in a body) before any fence is
	// involved.
	const factRows = await db
		.select({
			id: fact.id,
			statement: fact.statement,
			spanStart: fact.spanStart,
			spanEnd: fact.spanEnd,
			sourceBody: revision.body
		})
		.from(fact)
		.innerJoin(revision, eq(revision.id, fact.sourceRevisionId))
		.innerJoin(
			revelation,
			and(
				eq(revelation.factId, fact.id),
				eq(revelation.kind, 'fact'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.where(eq(fact.entityId, row.id))
		.orderBy(asc(fact.spanStart));

	// Guardrail 6: withheld here, not by the caller. `sourceBody` never leaves this function,
	// so no shape a route serialises can carry a fenced sentence even by accident.
	const facts: PublicFactRow[] = factRows
		.filter((factRow) =>
			isPlayerVisibleSpan(factRow.sourceBody, factRow.spanStart, factRow.spanEnd)
		)
		.map((factRow) => ({
			id: factRow.id,
			statement: factRow.statement,
			spanStart: factRow.spanStart,
			spanEnd: factRow.spanEnd,
			sourceExcerpt: factRow.sourceBody.slice(factRow.spanStart, factRow.spanEnd)
		}));

	const otherRevealedAt = sql<Date | null>`(
		select max(inner_rev.confirmed_at) from revelation inner_rev
		where inner_rev.entity_id = ${otherEntity.id}
			and inner_rev.kind = 'entity'
			and inner_rev.confirmed_at is not null
	)`;
	const ownLabel = sql`case when ${relation.fromEntityId} = ${row.id} then ${relationType.label} else ${relationType.inverseLabel} end`;
	const translatedLabel = sql`case when ${relation.fromEntityId} = ${row.id} then ${relationTypeLabel.label} else ${relationTypeLabel.inverseLabel} end`;
	const relationLabel =
		locale === undefined
			? sql<string>`${ownLabel}`
			: sql<string>`coalesce(${translatedLabel}, ${ownLabel})`;
	let relationQuery = db
		.select({
			key: relationType.key,
			label: relationLabel,
			direction: sql<
				'from' | 'to'
			>`case when ${relation.fromEntityId} = ${row.id} then 'from' else 'to' end`,
			other: {
				id: otherEntity.id,
				name: otherEntity.name,
				type: otherEntity.type,
				slug: otherEntity.slug
			},
			otherRevealedAt
		})
		.from(relation)
		.innerJoin(relationType, eq(relationType.id, relation.relationTypeId))
		.innerJoin(
			revelation,
			and(
				eq(revelation.relationId, relation.id),
				eq(revelation.kind, 'relation'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.innerJoin(
			otherEntity,
			sql`${otherEntity.id} = case when ${relation.fromEntityId} = ${row.id} then ${relation.toEntityId} else ${relation.fromEntityId} end`
		)
		.$dynamic();
	if (locale !== undefined) {
		relationQuery = relationQuery.leftJoin(
			relationTypeLabel,
			and(
				eq(relationTypeLabel.relationTypeId, relationType.id),
				eq(relationTypeLabel.locale, locale)
			)
		);
	}
	const relationRows = await relationQuery
		.where(
			and(
				or(eq(relation.fromEntityId, row.id), eq(relation.toEntityId, row.id)),
				ne(otherEntity.visibility, 'gm_only')
			)
		)
		.orderBy(asc(otherEntity.name));

	const imageRows = await db
		.select({ id: mediaAsset.id, kind: mediaAsset.kind })
		.from(mediaAsset)
		.where(and(eq(mediaAsset.entityId, row.id), eq(mediaAsset.publishedToPlayers, true)));

	// O2 (#284): resolved against the published rows just fetched rather than by a second
	// query on `cover_asset_id`, so the cover cannot pass a weaker gate than the gallery
	// does - it is a cover only if it is already one of the pictures this player may see
	// (guardrail 6). `kind === 'image'` because an audio asset has no business in an
	// `<img>`, the same local filter `PublicImages` applies.
	const cover =
		row.coverAssetId === null
			? null
			: (imageRows.find((image) => image.id === row.coverAssetId && image.kind === 'image') ??
				null);

	return {
		status: 'full',
		id: row.id,
		name: row.name,
		type: row.type,
		slug: row.slug,
		aliases: row.aliases,
		body: row.body,
		revealedAt: revealRow.confirmedAt,
		revealedInSession: revealRow.sessionName ?? null,
		facts,
		relations: relationRows.map((r) => ({
			key: r.key,
			label: r.label,
			direction: r.direction,
			other: { ...r.other, status: r.otherRevealedAt ? 'full' : 'gap' }
		})),
		images: imageRows,
		coverImageId: cover?.id ?? null
	};
}

export interface PublicMediaAssetRow {
	path: string;
	mimeType: string;
}

/** #254's `GET /p/[universe]/media/[id]` route gate, and its own body-image resolver in
 * `apps/web/src/lib/server/players.ts`. Deliberately built as the same two steps
 * `publicEntityBySlug` above already takes for its own entity - first the row joined
 * against `entity.visibility != 'gm_only'`, then a confirmed `'entity'` revelation check
 * - plus one more leg, `published_to_players`, since publication and visibility are two
 * independent switches and an image needs both: a GM's publish click is not itself a
 * revelation, and a revealed entity's images are not published by that reveal (guardrail
 * 6, issue #71). Undefined for any leg failing: wrong universe, unpublished, gm_only
 * entity, unrevealed entity, or an asset with no entity at all - a caller renders all of
 * those identically, the same "nothing here" `publicEntityBySlug`'s own doc comment
 * describes for its entity lookup. */
export async function publicMediaAssetById(
	db: Db,
	universeId: string,
	id: string
): Promise<PublicMediaAssetRow | undefined> {
	const [row] = await db
		.select({
			path: mediaAsset.path,
			mimeType: mediaAsset.mimeType,
			entityId: mediaAsset.entityId
		})
		.from(mediaAsset)
		.innerJoin(entity, eq(entity.id, mediaAsset.entityId))
		.where(
			and(
				eq(mediaAsset.id, id),
				eq(mediaAsset.universeId, universeId),
				eq(mediaAsset.publishedToPlayers, true),
				ne(entity.visibility, GM_ONLY_VISIBILITY)
			)
		)
		.limit(1);
	if (!row) return undefined;

	const [revealRow] = await db
		.select({ confirmedAt: revelation.confirmedAt })
		.from(revelation)
		.where(
			and(
				eq(revelation.entityId, row.entityId!),
				eq(revelation.kind, 'entity'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.limit(1);
	if (!revealRow?.confirmedAt) return undefined;

	return { path: row.path, mimeType: row.mimeType };
}

// -----------------------------------------------------------------------------------------
// Read: the GM's side of the same table (issue R11, round thirteen). `listPublicEntities`
// above answers "what does a player see"; this answers "what happened and when" - every
// confirmed `revelation` row, whatever it targets, with the session it was confirmed in.
// Guardrail 6 does not apply here the way it applies to `/p/**`: this is GM chrome, read
// by a member only (`/w/[universe]/players`'s own load), never rendered to a player.
// -----------------------------------------------------------------------------------------

export interface RevelationLogEntry {
	id: string;
	kind: RevelationKind;
	confirmedAt: Date;
	sessionName: string | null;
	label: string;
}

const revelationLogSession = alias(entity, 'revelation_log_session');
const revelationLogFromEntity = alias(entity, 'revelation_log_from_entity');
const revelationLogToEntity = alias(entity, 'revelation_log_to_entity');

/** Every confirmed `revelation` row for a universe, newest first, merged in TypeScript
 * from three small per-kind selects rather than a `union all` whose branches share
 * nothing but `id`/`confirmedAt`/session - the same call `recentActivity`
 * (`queries/activity.ts`) makes for the same reason. `locale`, when given, resolves a
 * relation's own #198 per-locale label exactly as `publicEntityBySlug`/`recentActivity`
 * already do. */
export async function revelationLogForUniverse(
	db: Db,
	universeId: string,
	opts?: { limit?: number; locale?: string }
): Promise<RevelationLogEntry[]> {
	const limit = opts?.limit ?? 200;
	const locale = opts?.locale;

	const entityRowsRaw = await db
		.select({
			id: revelation.id,
			confirmedAt: revelation.confirmedAt,
			sessionName: revelationLogSession.name,
			label: entity.name
		})
		.from(revelation)
		.innerJoin(entity, eq(entity.id, revelation.entityId))
		.leftJoin(revelationLogSession, eq(revelationLogSession.id, revelation.sessionEntityId))
		.where(
			and(
				eq(revelation.universeId, universeId),
				eq(revelation.kind, 'entity'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.orderBy(desc(revelation.confirmedAt))
		.limit(limit);

	const factRowsRaw = await db
		.select({
			id: revelation.id,
			confirmedAt: revelation.confirmedAt,
			sessionName: revelationLogSession.name,
			label: fact.statement
		})
		.from(revelation)
		.innerJoin(fact, eq(fact.id, revelation.factId))
		.leftJoin(revelationLogSession, eq(revelationLogSession.id, revelation.sessionEntityId))
		.where(
			and(
				eq(revelation.universeId, universeId),
				eq(revelation.kind, 'fact'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.orderBy(desc(revelation.confirmedAt))
		.limit(limit);

	const relationLabel =
		locale === undefined
			? sql<string>`${relationType.label}`
			: sql<string>`coalesce(${relationTypeLabel.label}, ${relationType.label})`;
	let relationQuery = db
		.select({
			id: revelation.id,
			confirmedAt: revelation.confirmedAt,
			sessionName: revelationLogSession.name,
			fromName: revelationLogFromEntity.name,
			toName: revelationLogToEntity.name,
			relationLabel
		})
		.from(revelation)
		.innerJoin(relation, eq(relation.id, revelation.relationId))
		.innerJoin(relationType, eq(relationType.id, relation.relationTypeId))
		.innerJoin(revelationLogFromEntity, eq(revelationLogFromEntity.id, relation.fromEntityId))
		.innerJoin(revelationLogToEntity, eq(revelationLogToEntity.id, relation.toEntityId))
		.leftJoin(revelationLogSession, eq(revelationLogSession.id, revelation.sessionEntityId))
		.$dynamic();
	if (locale !== undefined) {
		relationQuery = relationQuery.leftJoin(
			relationTypeLabel,
			and(
				eq(relationTypeLabel.relationTypeId, relationType.id),
				eq(relationTypeLabel.locale, locale)
			)
		);
	}
	const relationRowsRaw = await relationQuery
		.where(
			and(
				eq(revelation.universeId, universeId),
				eq(revelation.kind, 'relation'),
				isNotNull(revelation.confirmedAt)
			)
		)
		.orderBy(desc(revelation.confirmedAt))
		.limit(limit);

	const items: RevelationLogEntry[] = [
		...entityRowsRaw.flatMap((row) =>
			row.confirmedAt
				? [
						{
							id: row.id,
							kind: 'entity' as const,
							confirmedAt: row.confirmedAt,
							sessionName: row.sessionName,
							label: row.label
						}
					]
				: []
		),
		...factRowsRaw.flatMap((row) =>
			row.confirmedAt
				? [
						{
							id: row.id,
							kind: 'fact' as const,
							confirmedAt: row.confirmedAt,
							sessionName: row.sessionName,
							label: row.label
						}
					]
				: []
		),
		...relationRowsRaw.flatMap((row) =>
			row.confirmedAt
				? [
						{
							id: row.id,
							kind: 'relation' as const,
							confirmedAt: row.confirmedAt,
							sessionName: row.sessionName,
							label: `${row.fromName} ${row.relationLabel} ${row.toName}`
						}
					]
				: []
		)
	];

	return items.sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime()).slice(0, limit);
}
