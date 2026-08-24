/**
 * Which entries of a universe are missing from its own-canon collection (issue #709).
 *
 * The gap this answers: the index engine resolves the `embedding` purpose per run, and with
 * no active `model_config` row it records `index_outcome = {"status":"no-embedding-model"}`
 * and indexes nothing. Since #703 that state is findable. It still never came back, so every
 * entry saved, created or accepted while the row was missing stayed out of the collection
 * until somebody edited each one by hand.
 *
 * **Why this reads the collection and not the job rows.** #709 proposes either a scroll over
 * the collection or a read of the `canon_save_job` rows carrying `no-embedding-model`, and
 * calls the second cheaper. It is cheaper and it is not sufficient, in four ways that all
 * end with an entry silently left out forever:
 *
 * 1. A dead-lettered job never writes `index_outcome` at all - `completeCanonSaveJob` is the
 *    only writer and a `failed` row never reaches it - so the column is null and the
 *    `index_outcome->>'status' = 'no-embedding-model'` predicate does not match it.
 * 2. A row still `pending` or `claimed` when the backfill runs has the same null column, and
 *    a burst of saves against a universe with no embedding model is exactly when rows sit
 *    pending.
 * 3. An entity written by something that does not schedule a job at all has no row to read:
 *    `seed-fixture.ts` (which `scripts/demo-reset.sh` runs) and `packages/bench`'s corpus
 *    builders insert `entity` rows directly.
 * 4. Every entity that existed before #703 has body chunks and no entity-level point,
 *    because that point did not exist when it was indexed. Its job row says `ok`.
 *
 * The collection has none of those blind spots, because it is the thing the question is
 * actually about: an entry is retrievable or it is not, and Qdrant is where that is true.
 * The job rows keep the job #703 gave them, which is being the *trigger* signal - "this
 * universe has skipped at least once, go and look" - rather than the work list.
 *
 * The set difference is deliberately over the entity-level point rather than over any point.
 * `indexEntity` writes exactly one per entity and writes it for every entity (the match text
 * always carries at least the name), so "has an entity point" is a total predicate on
 * "`indexEntity` has run against this entry since #703". An entry that has body chunks and no
 * entity point is genuinely half-indexed and re-running the pipeline over it is what makes
 * the collection agree with canon, which is `runIndexEngine`'s whole contract.
 */
import { collectionExists, indexedEntityUrls, type QdrantClient } from '@canonry/vector';
import { entityLoreUrl } from './entity-pipeline.js';

export interface UnindexedEntitiesOptions {
	collectionName: string;
	universeId: string;
	dataSourceId: string;
	/** Every entity of the universe, in whatever order the caller read them - the returned
	 * subset keeps that order, so a caller that read them newest-first backfills newest-first
	 * and the entries a GM touched most recently come back to retrieval soonest. */
	entityIds: readonly string[];
}

export interface UnindexedEntitiesResult {
	/** The entries with no entity-level point, a subset of `entityIds` in the same order. */
	missing: string[];
	/** How many of `entityIds` do have one. `missing.length + indexed` is the input length. */
	indexed: number;
	/** Entity-level points found in the collection that match no entity in `entityIds` - a
	 * point left behind by an entry that has since been deleted without its points being
	 * cleaned up. Reported rather than repaired: this function enumerates, and deleting a
	 * point is a write that belongs to whoever owns the delete path. Zero in every case
	 * anybody has produced so far, and worth knowing about rather than silently subtracting,
	 * because a non-zero value means `deleteEntityLoreChunks` was missed somewhere. */
	orphanedPoints: number;
}

/**
 * The set difference, one scroll of the collection and no per-entity round trips.
 *
 * A collection that does not exist yet means nothing in this universe has ever been indexed,
 * which is the ordinary state of a universe whose `embedding` row has been missing since it
 * was created: every entry is missing. Checked rather than caught, because Qdrant answers a
 * scroll against an absent collection with a 404 that is indistinguishable here from a
 * transport failure, and a backfill that read "no points" out of a network error would report
 * a complete enumeration of nothing.
 */
export async function unindexedEntities(
	deps: { vectorClient: QdrantClient },
	options: UnindexedEntitiesOptions
): Promise<UnindexedEntitiesResult> {
	if (!(await collectionExists(deps.vectorClient, options.collectionName))) {
		return { missing: [...options.entityIds], indexed: 0, orphanedPoints: 0 };
	}
	const indexedUrls = await indexedEntityUrls(deps.vectorClient, options.collectionName, {
		universeId: options.universeId,
		dataSourceId: options.dataSourceId
	});
	const missing: string[] = [];
	let indexed = 0;
	for (const entityId of options.entityIds) {
		if (indexedUrls.delete(entityLoreUrl(entityId))) indexed += 1;
		else missing.push(entityId);
	}
	// Whatever is left in the set after every known entity has claimed its own url.
	return { missing, indexed, orphanedPoints: indexedUrls.size };
}
