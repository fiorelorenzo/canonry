/**
 * Indexes the seeded corpus into Qdrant through the product's own per-entity pipeline
 * (`indexEntity`, `@canonry/indexing`, issue #164) instead of a hand-rolled copy of it.
 *
 * The previous version of this file (`indexOwnCanon`, issue #168's own finding) chunked,
 * extracted and embedded by hand, because when it was written nothing indexed a
 * universe's own canon at all. Issue #164 shipped that path in `entity-pipeline.ts` -
 * `indexEntity` for one entity, `resolveOwnCanonCollection` for the collection and data
 * source it writes to - and the canon-save-job worker (`apps/web/src/lib/server/jobs/
 * canon-save.ts`) now calls it on every save. Keeping a second implementation here would
 * have meant the bench measuring a pipeline nothing ships, drifting from the real one on
 * the next change to chunking, extraction or the payload shape.
 *
 * The only thing this file does that `indexEntity` does not is the loop over the whole
 * corpus: a real save indexes one entity, seeding the bench indexes all of them at once.
 */
import { eq, type Db } from '@canonry/db';
import { entity } from '@canonry/db/schema';
import { resolveModel } from '@canonry/ai';
import { createVectorClient, type QdrantClient } from '@canonry/vector';
import { heuristicExtractor, indexEntity, resolveOwnCanonCollection } from '@canonry/indexing';
import { benchEmbedder } from './embedder.js';

export interface IndexedCanon {
	collection: string;
	chunks: number;
	vectorSize: number;
}

/**
 * Indexes every entity currently seeded in `universeId`, one `indexEntity` call each -
 * the same call the canon-save-job worker makes, run once per entity instead of once per
 * save. `heuristicExtractor` for chunk metadata, matching production: the embedding call
 * is the only one that touches the gateway.
 *
 * `options.chunkTokenBudget` and `options.collectionName` exist for one reason: issue
 * #168's own caveat that this corpus chunks one entity into one chunk, so a retrieval
 * question competes against every other entity in the world on a single whole-body
 * vector. Overriding the budget re-chunks finer without touching the shipped
 * `DEFAULT_CHUNK_TOKEN_BUDGET`; overriding the collection name keeps that experiment out
 * of the real "Own canon" collection `resolveOwnCanonCollection` resolves to, so a
 * one-off finer-chunking measurement can never leave stale points for the real one to
 * trip over later (the way the previous hand-rolled indexer's slug-keyed points did).
 */
export async function indexCorpus(
	db: Db,
	universeId: string,
	options: { chunkTokenBudget?: number; collectionName?: string } = {}
): Promise<IndexedCanon> {
	const embeddingModel = await resolveModel(db, 'embedding');
	const resolved = await resolveOwnCanonCollection(db, universeId, embeddingModel);
	const collectionName = options.collectionName ?? resolved.collectionName;
	const { vectorSize, dataSourceId } = resolved;
	const embedder = await benchEmbedder(db, universeId);
	const vectorClient: QdrantClient = createVectorClient();

	const rows = await db
		.select({ id: entity.id, name: entity.name, body: entity.body })
		.from(entity)
		.where(eq(entity.universeId, universeId));

	let chunks = 0;
	for (const row of rows) {
		const result = await indexEntity(
			{ db, vectorClient, extractor: heuristicExtractor, embedder },
			{
				dataSourceId,
				universeId,
				entityId: row.id,
				entityName: row.name,
				body: row.body,
				collectionName,
				vectorSize,
				...(options.chunkTokenBudget === undefined
					? {}
					: { chunkTokenBudget: options.chunkTokenBudget })
			}
		);
		chunks += result.chunkCount;
	}

	return { collection: collectionName, chunks, vectorSize };
}
