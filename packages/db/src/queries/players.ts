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
 * Secrets (#84) are not this file's concern: `entity.body` here is the raw stored markdown,
 * fences and all. Stripping them for players is `apps/web/src/lib/markdown-secrets.ts`'s
 * job, one layer up, because a stored-markdown concern has no business in a package with no
 * opinion on markdown.
 */
import { and, asc, desc, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType, MediaKind, RevelationKind } from '../schema/enums.js';
import { fact } from '../schema/fact.js';
import { mediaAsset } from '../schema/media.js';
import { revelation } from '../schema/players.js';
import { relation, relationType } from '../schema/relation.js';
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
		.where(and(eq(entity.universeId, universeId), ne(entity.visibility, 'gm_only')));
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

export interface PublicFactRow {
	id: string;
	statement: string;
	spanStart: number;
	spanEnd: number;
	sourceExcerpt: string;
}

export interface PublicRelationRow {
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
	/** Raw stored markdown, secret and GM-note fences included - #83's caller in
	 * apps/web is responsible for running this through markdown-secrets before it ever
	 * reaches a page's data. See this file's module doc. */
	body: string;
	revealedAt: Date;
	revealedInSession: string | null;
	facts: PublicFactRow[];
	relations: PublicRelationRow[];
	images: PublicImageRow[];
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
	slug: string
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

	const factRows = await db
		.select({
			id: fact.id,
			statement: fact.statement,
			spanStart: fact.spanStart,
			spanEnd: fact.spanEnd,
			sourceExcerpt: sql<string>`substring(${revision.body} from ${fact.spanStart} + 1 for ${fact.spanEnd} - ${fact.spanStart})`
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

	const otherRevealedAt = sql<Date | null>`(
		select max(inner_rev.confirmed_at) from revelation inner_rev
		where inner_rev.entity_id = ${otherEntity.id}
			and inner_rev.kind = 'entity'
			and inner_rev.confirmed_at is not null
	)`;
	const relationRows = await db
		.select({
			label: sql<string>`case when ${relation.fromEntityId} = ${row.id} then ${relationType.label} else ${relationType.inverseLabel} end`,
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
		facts: factRows,
		relations: relationRows.map((r) => ({
			label: r.label,
			direction: r.direction,
			other: { ...r.other, status: r.otherRevealedAt ? 'full' : 'gap' }
		})),
		images: imageRows
	};
}
