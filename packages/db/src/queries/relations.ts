import { eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { entity } from '../schema/entity.js';
import type { EntityType } from '../schema/enums.js';
import { relation, relationType } from '../schema/relation.js';

export interface RelationOtherEntity {
	id: string;
	name: string;
	type: EntityType;
	slug: string;
}

export interface RelationView {
	label: string;
	other: RelationOtherEntity;
	direction: 'from' | 'to';
}

const otherEntity = alias(entity, 'other_entity');

/** #16 acceptance: renders the label from the perspective of whichever entity you asked
 * about, so the one stored row reads as e.g. "commands" from one end and "commanded by"
 * from the other. `other` carries the entity itself (decision B3's relations panel
 * renders name and type), not just its id, so a caller never needs a second query per
 * row. Ordered by label then the other entity's name so the panel is stable across reads. */
export async function relationsFor(db: Db, entityId: string): Promise<RelationView[]> {
	const label = sql<string>`case when ${relation.fromEntityId} = ${entityId} then ${relationType.label} else ${relationType.inverseLabel} end`;
	const otherEntityId = sql`case when ${relation.fromEntityId} = ${entityId} then ${relation.toEntityId} else ${relation.fromEntityId} end`;

	return db
		.select({
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
		.where(or(eq(relation.fromEntityId, entityId), eq(relation.toEntityId, entityId)))
		.orderBy(label, otherEntity.name);
}
