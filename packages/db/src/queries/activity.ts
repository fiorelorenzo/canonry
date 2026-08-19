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
