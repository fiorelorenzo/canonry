/**
 * Loads one universe into the `CandidateGraph` shape `candidates.ts` scores (issue #49).
 * Whole-universe on purpose: reverse-mention retrieval (candidates.ts's source 3) has to
 * check every other entity's body for a mention of the one that changed, and there is no
 * way to know which entities are "nearby" for that check without first having all of them
 * - the graph-hop pass needs the full relation set for the same reason (2-hop reachability
 * cannot be computed from a partial graph). For a GM's homebrew world this is a few dozen
 * to a few hundred rows, not the kind of scale that needs a bounded query; if that stops
 * being true, this is the file to add a real mention/embedding index in front of.
 */
import { eq, type Db } from '@canonry/db';
import { entity, relation, relationType } from '@canonry/db/schema';
import type { CandidateGraph } from './candidates.js';

export async function loadCandidateGraph(db: Db, universeId: string): Promise<CandidateGraph> {
	const [entityRows, relationRows] = await Promise.all([
		db
			.select({
				id: entity.id,
				type: entity.type,
				name: entity.name,
				aliases: entity.aliases,
				body: entity.body,
				language: entity.language
			})
			.from(entity)
			.where(eq(entity.universeId, universeId)),
		db
			.select({
				fromId: relation.fromEntityId,
				toId: relation.toEntityId,
				label: relationType.label
			})
			.from(relation)
			.innerJoin(relationType, eq(relationType.id, relation.relationTypeId))
			.where(eq(relation.universeId, universeId))
	]);

	return {
		entities: entityRows,
		relations: relationRows
	};
}
