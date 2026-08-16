/**
 * The chunk -> extract -> embed -> upsert path for a universe's *own* canon (issue #164):
 * `pipeline.ts`'s `indexDataSource` crawls a MediaWiki for SPEC.md §7's pre-indexed
 * universes, which is the only path that has ever written to a lore collection - a
 * homebrew universe with hand-written entries and no data source got nothing, so Ask's
 * second retrieval layer (`@canonry/copilot`'s `searchIndexed`) never had anything of the
 * GM's own to find.
 *
 * `indexEntity` is that other path: one entity's current body, chunked and embedded the
 * same way a wiki page is, into the same kind of lore collection, under the "Own canon"
 * `data_source` row (`ownCanonDataSource`, `@canonry/db`) rather than a reviewed wiki
 * source. It is deliberately *not* `indexDataSource` reused - there is no wiki client, no
 * page list, no per-page idempotency check against a remote `updatedAt`: the caller (the
 * canon-save-job worker) already knows whether the body changed, because it is the one
 * that just wrote it.
 *
 * `deleteEntityLoreChunks` is the other half issue #164 asks for: an entity delete has to
 * remove its points too, or a stale chunk keeps answering questions about canon that no
 * longer exists.
 */
import type { Db } from '@canonry/db';
import { ownCanonDataSource } from '@canonry/db';
import type { ResolvedModel } from '@canonry/ai';
import {
	deleteLorePage,
	ensureCollection,
	loreCollectionNameForModel,
	upsertLoreChunks,
	type LoreChunk,
	type QdrantClient
} from '@canonry/vector';
import { detectLanguage } from '@canonry/lang';
import { chunkWikiPage, DEFAULT_CHUNK_TOKEN_BUDGET } from './chunking.js';
import type { ChunkExtractor } from './extraction.js';
import type { Embedder } from './embedding.js';
import { chunkPointId } from './point-id.js';
import { embeddingDimensionsFor } from './models.js';

/** The synthetic `url` an entity's chunks are stored and looked up under - `LoreChunkPayload.url`
 * has no other meaning for an entity than "which entity", and Qdrant only accepts an integer or a
 * UUID as a point id (`chunkPointId` hashes this, plus the chunk index, into one). Keyed on the
 * entity's own id rather than its slug: a slug is a display concern and this has to keep pointing
 * at the same chunks across a rename, which the entity's id never does. */
export function entityLoreUrl(entityId: string): string {
	return `canonry://entity/${entityId}`;
}

export interface IndexEntityDeps {
	db: Db;
	vectorClient: QdrantClient;
	extractor: ChunkExtractor;
	embedder: Embedder;
}

export interface IndexEntityOptions {
	dataSourceId: string;
	universeId: string;
	entityId: string;
	entityName: string;
	body: string;
	collectionName: string;
	vectorSize: number;
	chunkTokenBudget?: number;
}

export interface IndexEntityResult {
	chunkCount: number;
}

/**
 * Chunks, extracts and embeds `options.body`, then deletes whatever this entity had
 * indexed before and upserts the new chunks - stale points first, exactly like
 * `pipeline.ts`'s `indexPage`, so a body that shrank never leaves orphaned points at
 * indices past the new chunk count. An empty body (a freshly created, still-unwritten
 * entry) chunks to nothing and this becomes a pure delete, which is the correct thing for
 * an entry with nothing to index.
 */
export async function indexEntity(
	deps: IndexEntityDeps,
	options: IndexEntityOptions
): Promise<IndexEntityResult> {
	await ensureCollection(deps.vectorClient, {
		name: options.collectionName,
		vectorSize: options.vectorSize,
		// Mirrors `indexDataSource`'s own choice: a width change is a re-index someone has
		// to ask for, never something this pipeline destroys on its own initiative.
		onDimensionMismatch: 'throw'
	});

	const url = entityLoreUrl(options.entityId);
	const wikiChunks = chunkWikiPage(options.entityName, options.body, {
		tokenBudget: options.chunkTokenBudget ?? DEFAULT_CHUNK_TOKEN_BUDGET
	});

	const metadata = await Promise.all(
		wikiChunks.map((chunk) =>
			deps.extractor({
				pageTitle: options.entityName,
				breadcrumb: chunk.breadcrumb,
				text: chunk.text
			})
		)
	);
	const vectors = await deps.embedder(wikiChunks.map((chunk) => chunk.text));

	const indexedAt = new Date().toISOString();
	const loreChunks: LoreChunk[] = wikiChunks.map((chunk, i) => {
		const chunkMetadata = metadata[i]!;
		return {
			id: chunkPointId(options.dataSourceId, url, chunk.index),
			vector: vectors[i]!,
			payload: {
				text: chunk.text,
				breadcrumb: chunk.breadcrumb,
				pageTitle: options.entityName,
				url,
				// There is no wiki revision timestamp for an entity's own body - `indexedAt`
				// doubles as `pageUpdatedAt` here, which only ever matters to `findPageUpdatedAt`'s
				// idempotency check, a MediaWiki-crawl concern this path does not use at all: the
				// canon-save-job worker already knows whether the body changed.
				pageUpdatedAt: indexedAt,
				indexedAt,
				universeId: options.universeId,
				dataSourceId: options.dataSourceId,
				sectionSummary: chunkMetadata.sectionSummary,
				questionsThisExcerptCanAnswer: chunkMetadata.questionsThisExcerptCanAnswer,
				excerptKeywords: chunkMetadata.excerptKeywords,
				language: detectLanguage(chunk.text)
			}
		};
	});

	await deleteLorePage(deps.vectorClient, options.collectionName, {
		universeId: options.universeId,
		dataSourceId: options.dataSourceId,
		url
	});
	await upsertLoreChunks(deps.vectorClient, options.collectionName, loreChunks);

	return { chunkCount: loreChunks.length };
}

export interface DeleteEntityLoreChunksDeps {
	vectorClient: QdrantClient;
}

export interface DeleteEntityLoreChunksOptions {
	collectionName: string;
	universeId: string;
	dataSourceId: string;
	entityId: string;
}

/** An entity delete has to remove its points too (issue #164) - otherwise a stale chunk
 * keeps answering Ask questions about canon that no longer exists. Deleting a filter that
 * matches nothing (an entity that was never indexed) is a no-op, not an error. */
export async function deleteEntityLoreChunks(
	deps: DeleteEntityLoreChunksDeps,
	options: DeleteEntityLoreChunksOptions
): Promise<void> {
	await deleteLorePage(deps.vectorClient, options.collectionName, {
		universeId: options.universeId,
		dataSourceId: options.dataSourceId,
		url: entityLoreUrl(options.entityId)
	});
}

export interface OwnCanonCollection {
	collectionName: string;
	vectorSize: number;
	dataSourceId: string;
}

/** Everything a caller needs to read or write a universe's own-canon collection, resolved
 * from an already-resolved embedding model: the collection name (`loreCollectionNameForModel`
 * already keys it by model, so a model change never reads or writes the wrong vectors), the
 * width that model produces, and the "Own canon" `data_source` row's id (found or created,
 * `@canonry/db`'s `ownCanonDataSource`) that `LoreChunkPayload.dataSourceId` has to be a real
 * row for - `retrieveForUniverse` loads it to apply exclusion patterns. Shared by the
 * canon-save-job worker's index engine and the entity-delete cleanup path so both compute the
 * same collection the same way. */
export async function resolveOwnCanonCollection(
	db: Db,
	universeId: string,
	embeddingModel: ResolvedModel
): Promise<OwnCanonCollection> {
	const dataSourceRow = await ownCanonDataSource(db, universeId);
	return {
		collectionName: loreCollectionNameForModel(embeddingModel, universeId),
		vectorSize: embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId),
		dataSourceId: dataSourceRow.id
	};
}
