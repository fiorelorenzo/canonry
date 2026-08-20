/**
 * O1 = C (#283): the world home's recent activity feed, one of the three sections the
 * decision names.
 *
 * Three sources, because those are the three things that actually happen to a world and
 * already leave a dated row behind: a revision (an entry's body changed, guardrail 2's own
 * record), a relation (two entries were connected), and a work node (a scene or session was
 * touched). Nothing new is written to produce this feed, and no fourth source is invented:
 * an event with no timestamped row today would need one, which is a migration and a
 * different issue.
 *
 * `authorKind` rides along on the two rows that carry it, so the feed keeps guardrail 2's
 * distinction visible after the fact: a line a human wrote and a line accepted from the
 * copilot are not the same event, and a feed that flattened them would be the first place
 * in the product where that difference disappeared.
 *
 * Merged in TypeScript rather than in one `union all`: three small indexed selects, each
 * capped at the same limit, are cheaper to read and to change than a union whose branches
 * have to agree on a column list they share nothing with.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import { relation, relationType, relationTypeLabel } from '../schema/relation.js';
import { revision } from '../schema/revision.js';
import { work, workNode } from '../schema/work.js';
import type { AuthorKind } from '../schema/enums.js';

export interface RevisionActivity {
	kind: 'revision';
	id: string;
	at: Date;
	authorKind: AuthorKind;
	entityName: string;
	entitySlug: string;
}

export interface RelationActivity {
	kind: 'relation';
	id: string;
	at: Date;
	authorKind: AuthorKind;
	/** Stable identity for the display lookup (decision L1, #195); `label` is the
	 * fallback, resolved the same way `relationsFor` resolves it. */
	relationKey: string;
	label: string;
	fromName: string;
	fromSlug: string;
	toName: string;
}

export interface WorkActivity {
	kind: 'work';
	id: string;
	at: Date;
	workName: string;
	workSlug: string;
	nodeTitle: string;
}

export type ActivityItem = RevisionActivity | RelationActivity | WorkActivity;

const toEntityAlias = alias(entity, 'to_entity');

/**
 * The newest `limit` things that happened in a world, newest first. `locale`, when given,
 * resolves #198's per-locale relation label in the query, exactly as `relationsFor` does -
 * a caller still prefers the i18n bundle for one of the shipped ten, keyed off
 * `relationKey`.
 */
export async function recentActivity(
	db: Db,
	universeId: string,
	opts?: { limit?: number; locale?: string }
): Promise<ActivityItem[]> {
	const limit = opts?.limit ?? 8;
	const locale = opts?.locale;

	const label =
		locale === undefined
			? sql<string>`${relationType.label}`
			: sql<string>`coalesce(${relationTypeLabel.label}, ${relationType.label})`;

	const relationQuery = db
		.select({
			id: relation.id,
			at: relation.createdAt,
			authorKind: relation.authorKind,
			relationKey: relationType.key,
			label,
			fromName: entity.name,
			fromSlug: entity.slug,
			toName: toEntityAlias.name
		})
		.from(relation)
		.innerJoin(relationType, eq(relationType.id, relation.relationTypeId))
		.innerJoin(entity, eq(entity.id, relation.fromEntityId))
		.innerJoin(toEntityAlias, eq(toEntityAlias.id, relation.toEntityId))
		.$dynamic();

	const [revisions, relations, nodes] = await Promise.all([
		db
			.select({
				id: revision.id,
				at: revision.createdAt,
				authorKind: revision.authorKind,
				entityName: entity.name,
				entitySlug: entity.slug
			})
			.from(revision)
			.innerJoin(entity, eq(entity.id, revision.entityId))
			.where(eq(revision.universeId, universeId))
			.orderBy(desc(revision.createdAt))
			.limit(limit),
		(locale === undefined
			? relationQuery
			: relationQuery.leftJoin(
					relationTypeLabel,
					sql`${relationTypeLabel.relationTypeId} = ${relationType.id} and ${relationTypeLabel.locale} = ${locale}`
				)
		)
			.where(eq(relation.universeId, universeId))
			.orderBy(desc(relation.createdAt))
			.limit(limit),
		db
			.select({
				id: workNode.id,
				at: workNode.updatedAt,
				workName: work.name,
				workSlug: work.slug,
				nodeTitle: workNode.title
			})
			.from(workNode)
			.innerJoin(work, eq(work.id, workNode.workId))
			.where(eq(work.universeId, universeId))
			.orderBy(desc(workNode.updatedAt))
			.limit(limit)
	]);

	const items: ActivityItem[] = [
		...revisions.map((row): RevisionActivity => ({ kind: 'revision', ...row })),
		...relations.map((row): RelationActivity => ({ kind: 'relation', ...row })),
		...nodes.map((row): WorkActivity => ({ kind: 'work', ...row }))
	];

	return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** One rolling seven-day bucket of the world's changes, `weeksAgo` 0 being the last seven
 * days. Only buckets that actually carry a change come back, so a quiet world returns a
 * short array or an empty one rather than a row of zeroes. */
export interface WeeklyChangeCount {
	weeksAgo: number;
	count: number;
}

/**
 * How much a world changed, week by week, over the last `weeks` rolling weeks (#348).
 *
 * Four sources, which is `recentActivity`'s three plus entity creation. The three shared
 * ones are shared on purpose: the pulse and the feed under it have to agree about what
 * happened in a world, or the masthead counts events the list never shows. Creation is the
 * one the feed does not carry and this cannot do without, because `createEntity` writes no
 * `revision` (see `entities.ts`: `saveEntityBody` is guardrail 2's single write path), so a
 * world where a GM created six entries this afternoon and has not edited a body yet has
 * six new entries and no revision row at all. Counting only the feed's three sources there
 * put "nothing has changed in twelve weeks" above six cards saying "changed 10m ago",
 * which is the masthead calling the page under it a liar. A line in the feed for a created
 * entry is a separate question and belongs to the feed, not here.
 *
 * What differs from the feed is the resolution, and that is the point: the feed says which
 * eight things happened, this says how the last three months were shaped, which is the one
 * thing neither the feed nor the sidebar nor the quota meter answers.
 *
 * One round trip: four range scans unioned, bucketed and grouped in Postgres, at most
 * `weeks` rows back. The buckets are arithmetic on the epoch rather than
 * `date_trunc('week', ...)`, so the answer does not depend on the server's `TimeZone`
 * setting and "the last seven days" means exactly that rather than "since Monday".
 */
export async function weeklyChangeCounts(
	db: Db,
	universeId: string,
	opts?: { weeks?: number }
): Promise<WeeklyChangeCount[]> {
	const weeks = opts?.weeks ?? 12;
	const rows = await db.execute<{ weeks_ago: number; count: string }>(sql`
		with changes as (
			select created_at as at from ${entity} where universe_id = ${universeId}::uuid
			union all
			select created_at as at from ${revision} where universe_id = ${universeId}::uuid
			union all
			select created_at as at from ${relation} where universe_id = ${universeId}::uuid
			union all
			select wn.updated_at as at
			from ${workNode} wn
			join ${work} w on w.id = wn.work_id
			where w.universe_id = ${universeId}::uuid
		)
		select
			floor(extract(epoch from (now() - at)) / 604800)::int as weeks_ago,
			count(*) as count
		from changes
		where at > now() - make_interval(weeks => ${weeks})
		group by weeks_ago
		order by weeks_ago
	`);

	return rows.map((row) => ({ weeksAgo: Number(row.weeks_ago), count: Number(row.count) }));
}
