import { and, eq, type Db } from '@canonry/db';
import { dataSource, entity } from '@canonry/db/schema';
import { resolveModel } from '@canonry/ai';
import {
	createVectorClient,
	ensureCollection,
	loreCollectionNameForModel,
	upsertLoreChunks
} from '@canonry/vector';
import { chunkPointId, chunkWikiPage, heuristicExtractor } from '@canonry/indexing';
import { detectLanguage } from '@canonry/lang';
import { benchEmbedder } from './embedder.js';

/** The name of the `data_source` row that stands in for the universe's own canon. It has
 * to be a real row, not a made-up id: `LoreChunkPayload.dataSourceId` is read back by
 * `retrieveForUniverse`, which loads the source to apply its exclusion patterns, so a
 * synthetic id makes every Ask fail with a foreign-key-shaped query error rather than
 * returning nothing. Worth recording, because that is what happened here first. */
const OWN_CANON_SOURCE_NAME = 'Own canon (bench)';

/** Finds or creates that row. `status: 'indexed'` and a reviewed licence, because the
 * licence gate (`requireIndexableDataSource`) exists for somebody else's wiki and a
 * universe's own writing is not that. */
export async function ownCanonDataSourceId(db: Db, universeId: string): Promise<string> {
	const existing = await db
		.select({ id: dataSource.id })
		.from(dataSource)
		.where(and(eq(dataSource.universeId, universeId), eq(dataSource.name, OWN_CANON_SOURCE_NAME)))
		.limit(1);
	const found = existing[0]?.id;
	if (found) return found;
	const inserted = await db
		.insert(dataSource)
		.values({
			universeId,
			type: 'text',
			name: OWN_CANON_SOURCE_NAME,
			status: 'indexed',
			licence: 'the universe owner wrote it',
			licenceReviewedAt: new Date(),
			attribution: ''
		})
		.returning({ id: dataSource.id });
	const id = inserted[0]?.id;
	if (!id) throw new Error('own-canon data source insert returned no row');
	return id;
}

export interface IndexedCanon {
	collection: string;
	chunks: number;
	vectorSize: number;
}

/**
 * Indexes the seeded canon into Qdrant.
 *
 * `indexDataSource` in `packages/indexing` is the shipped pipeline, and it crawls a
 * MediaWiki: it exists for SPEC.md §7's pre-indexed universes, not for a GM's own entries.
 * There is no shipped path that indexes a universe's own canon, which is a real gap and
 * worth saying plainly rather than papering over: Ask's second retrieval layer can
 * therefore only ever find imported wiki content today, never the GM's own writing. So
 * this runner does the chunking and embedding itself, with the same chunker, the same
 * extractor shape and the same collection naming the pipeline uses, in order to have
 * something to measure retrieval against at all.
 */
export async function indexOwnCanon(db: Db, universeId: string): Promise<IndexedCanon> {
	const resolved = await resolveModel(db, 'embedding');
	const collection = loreCollectionNameForModel(resolved, universeId);
	const embedder = await benchEmbedder(db, universeId);
	const client = createVectorClient();
	const dataSourceId = await ownCanonDataSourceId(db, universeId);

	const rows = await db
		.select({ slug: entity.slug, name: entity.name, body: entity.body })
		.from(entity)
		.where(eq(entity.universeId, universeId));

	const texts: string[] = [];
	const pending: Array<{
		slug: string;
		name: string;
		index: number;
		breadcrumb: string;
		text: string;
	}> = [];
	for (const row of rows) {
		for (const chunk of chunkWikiPage(row.name, row.body)) {
			pending.push({
				slug: row.slug,
				name: row.name,
				index: chunk.index,
				breadcrumb: chunk.breadcrumb,
				text: chunk.text
			});
			texts.push(chunk.text);
		}
	}

	const vectors = await embedder(texts);
	const vectorSize = vectors[0]?.length ?? 0;
	if (vectorSize === 0) throw new Error('the embedder returned no dimensions');
	await ensureCollection(client, { name: collection, vectorSize, onDimensionMismatch: 'recreate' });

	const indexedAt = new Date().toISOString();
	await upsertLoreChunks(
		client,
		collection,
		await Promise.all(
			pending.map(async (chunk, i) => {
				const metadata = await heuristicExtractor({
					pageTitle: chunk.name,
					breadcrumb: chunk.breadcrumb,
					text: chunk.text
				});
				return {
					// Qdrant only accepts an unsigned integer or a UUID as a point id, so the
					// slug-and-index string a reader would want is not one. `chunkPointId` is the
					// product's own deterministic UUID v5 over the same three parts, which is also
					// what makes a re-index an upsert rather than a duplicate.
					id: chunkPointId(dataSourceId, `canonry://entity/${chunk.slug}`, chunk.index),
					vector: vectors[i]!,
					payload: {
						text: chunk.text,
						breadcrumb: chunk.breadcrumb,
						pageTitle: chunk.name,
						url: `canonry://entity/${chunk.slug}`,
						pageUpdatedAt: indexedAt,
						indexedAt,
						universeId,
						dataSourceId,
						sectionSummary: metadata.sectionSummary,
						questionsThisExcerptCanAnswer: metadata.questionsThisExcerptCanAnswer,
						excerptKeywords: metadata.excerptKeywords,
						language: detectLanguage(chunk.text)
					}
				};
			})
		)
	);

	return { collection, chunks: pending.length, vectorSize };
}
