import { and, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType } from '../schema/enums.js';
import { relation, relationType, relationTypeLabel } from '../schema/relation.js';

export interface RelationOtherEntity {
	id: string;
	name: string;
	type: EntityType;
	slug: string;
}

export interface RelationView {
	/** Stable identity (decision L1, #195) - a display lookup keys off this plus
	 * `direction`, never off `label`. */
	key: string;
	/** Perspective-resolved display word: for the shipped ten this is the authored
	 * English text and a caller ignores it in favour of `Messages.relationTypeLabel(key)`
	 * (#196). For a universe's own type it is the whole answer - the authored label when
	 * `locale` (below) has no translation for it yet, or #198's saved translation for
	 * `locale` when one exists. Either way this field alone is already the right string
	 * to render; nothing downstream needs to know which case produced it. */
	label: string;
	other: RelationOtherEntity;
	direction: 'from' | 'to';
}

const otherEntity = alias(entity, 'other_entity');

/** #16 acceptance: renders the label from the perspective of whichever entity you asked
 * about, so the one stored row reads as e.g. "commands" from one end and "commanded by"
 * from the other. `other` carries the entity itself (decision B3's relations panel
 * renders name and type), not just its id, so a caller never needs a second query per
 * row. Ordered by label then the other entity's name so the panel is stable across reads.
 *
 * `locale`, when given, resolves #198's per-locale translation into `label` directly -
 * `coalesce(translation, authored)` in the query itself, not a second lookup a caller
 * has to remember to do. Omitted entirely by every caller that reads relations for
 * something other than display (packages/copilot's resolver matches on `key`, never on
 * `label`), so `label` there stays exactly the authored text, matching this function's
 * behaviour before #198. A shipped type never has a translation row to join against
 * (the migration's `relation_type_label_owned_only_trigger`), so passing `locale` for a
 * relation of a shipped type is harmless - the coalesce always falls through to the
 * authored word, which a caller then overrides with the i18n bundle anyway. */
export async function relationsFor(
	db: Db,
	entityId: string,
	locale?: string
): Promise<RelationView[]> {
	const ownLabel = sql`case when ${relation.fromEntityId} = ${entityId} then ${relationType.label} else ${relationType.inverseLabel} end`;
	const translatedLabel = sql`case when ${relation.fromEntityId} = ${entityId} then ${relationTypeLabel.label} else ${relationTypeLabel.inverseLabel} end`;
	const label =
		locale === undefined
			? sql<string>`${ownLabel}`
			: sql<string>`coalesce(${translatedLabel}, ${ownLabel})`;
	const otherEntityId = sql`case when ${relation.fromEntityId} = ${entityId} then ${relation.toEntityId} else ${relation.fromEntityId} end`;

	let query = db
		.select({
			key: relationType.key,
			label,
			other: {
				id: otherEntity.id,
				name: otherEntity.name,
				type: otherEntity.type,
				slug: otherEntity.slug
			},
			direction: sql<
				'from' | 'to'
			>`case when ${relation.fromEntityId} = ${entityId} then 'from' else 'to' end`
		})
		.from(relation)
		.innerJoin(relationType, eq(relationType.id, relation.relationTypeId))
		.innerJoin(otherEntity, sql`${otherEntity.id} = ${otherEntityId}`)
		.$dynamic();
	if (locale !== undefined) {
		query = query.leftJoin(
			relationTypeLabel,
			and(
				eq(relationTypeLabel.relationTypeId, relationType.id),
				eq(relationTypeLabel.locale, locale)
			)
		);
	}
	return query
		.where(or(eq(relation.fromEntityId, entityId), eq(relation.toEntityId, entityId)))
		.orderBy(ownLabel, otherEntity.name);
}
