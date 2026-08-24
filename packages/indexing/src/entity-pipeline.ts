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
 * canon-save-job worker) reads the entity it is about to index, and this makes the
 * collection agree with it.
 *
 * Since issue #703 it writes two kinds of point per entity, not one: the body chunks it
 * always wrote, and one entity-level point carrying the entity's type and the name-and-
 * aliases text the merge engine's `matchTextFor` builds. Retrieval before that could only
 * reach an entity through its body, so a named-but-unwritten entry was invisible to the
 * copilot. The two kinds are told apart by `LoreChunkPayload.pointKind`, which is what lets
 * the name point survive a body being emptied.
 *
 * `deleteEntityLoreChunks` is the other half issue #164 asks for: an entity delete has to
 * remove its points too, or a stale chunk keeps answering questions about canon that no
 * longer exists. That one takes both kinds, because the entity itself is gone.
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
import { chunkPointId, entityPointId } from './point-id.js';
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
	/** `entity.type`, carried on every point this writes (issue #703). A plain string rather
	 * than `EntityType` because nothing here reads it: it is payload for a type-scoped read
	 * that does not exist yet, and importing the enum would tie this package's signature to a
	 * vocabulary the vector layer does not have either. */
	entityType: string;
	/**
	 * The text of the entity-level point: what the merge engine's `matchTextFor`
	 * (`@canonry/import`) builds out of the entity's name, aliases, type and first line.
	 *
	 * Passed in rather than built here, and that is the point rather than an accident.
	 * `matchTextFor` is the single definition of "how one side of a match is embedded", and
	 * the reason to write this point at all is that the same text becomes comparable to what
	 * the scorer embeds. `@canonry/indexing` cannot import `@canonry/import` (that package
	 * depends on `@canonry/copilot`, which depends on this one), so a copy of the text shape
	 * here would be a second definition, free to drift, of the one thing that has to agree.
	 * The composition root passes it instead, the same way it passes the embedder.
	 */
	entityMatchText: string;
	collectionName: string;
	vectorSize: number;
	chunkTokenBudget?: number;
}

export interface IndexEntityResult {
	chunkCount: number;
	/** Issue #703: whether the entity-level point was written. False only for an entity whose
	 * `entityMatchText` is blank, which takes a nameless entity to produce and which nothing
	 * in this product can create. */
	entityPointWritten: boolean;
}

/**
 * Chunks, extracts and embeds `options.body`, then deletes whatever body chunks this entity
 * had indexed before and upserts the new ones - stale points first, exactly like
 * `pipeline.ts`'s `indexPage`, so a body that shrank never leaves orphaned points at
 * indices past the new chunk count.
 *
 * Plus, since issue #703, exactly one entity-level point beside those chunks, carrying the
 * entity's type and `matchTextFor` text instead of any prose. Retrieval before it could only
 * ever find an entity through its body, so an entry a GM had named and not yet written was
 * invisible to the copilot: it existed in the wiki and could not be cited, and #535's floor
 * work made that sharper, because an answer that cites nothing now says so and "nothing"
 * conflated "this entry has no body yet" with "the world does not say".
 *
 * **The delete is scoped to body points, and that is what makes the feature survive.** An
 * empty body chunks to nothing, so before #703 this call was a pure delete for a bodyless
 * entry, which is the correct thing to do with prose that no longer exists and the wrong
 * thing to do with the name point whose entire purpose is to outlive it. Clearing by entity
 * id would have worked until the first GM emptied a paragraph and then stopped silently.
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
	const matchText = options.entityMatchText.trim();

	const metadata = await Promise.all(
		wikiChunks.map((chunk) =>
			deps.extractor({
				pageTitle: options.entityName,
				breadcrumb: chunk.breadcrumb,
				text: chunk.text
			})
		)
	);
	// One batch for the body chunks and the name text together: `Embedder` is a batch seam
	// and the entity point is one more short text, so this stays one gateway round trip per
	// entity rather than becoming two.
	const texts = wikiChunks.map((chunk) => chunk.text);
	if (matchText.length > 0) texts.push(matchText);
	const vectors = await deps.embedder(texts);

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
				// canon-save-job worker indexes whatever the entity currently says.
				pageUpdatedAt: indexedAt,
				indexedAt,
				universeId: options.universeId,
				dataSourceId: options.dataSourceId,
				sectionSummary: chunkMetadata.sectionSummary,
				questionsThisExcerptCanAnswer: chunkMetadata.questionsThisExcerptCanAnswer,
				excerptKeywords: chunkMetadata.excerptKeywords,
				pointKind: 'body',
				entityType: options.entityType,
				language: detectLanguage(chunk.text)
			}
		};
	});

	const entityPoint: LoreChunk | null =
		matchText.length > 0
			? {
					id: entityPointId(options.dataSourceId, url),
					vector: vectors[texts.length - 1]!,
					payload: {
						text: matchText,
						// No section to breadcrumb into: this point is the entry itself, not a
						// passage of it, so the entry's own name is the whole trail.
						breadcrumb: options.entityName,
						pageTitle: options.entityName,
						url,
						pageUpdatedAt: indexedAt,
						indexedAt,
						universeId: options.universeId,
						dataSourceId: options.dataSourceId,
						// The three extracted metadata fields are a property of a chunk of prose,
						// and this point is not one. Empty rather than invented: `sectionSummary`
						// would restate the name, and a keyword list here would hand the retriever's
						// keyword boost (`retriever.ts`, 0.03 per match) to every entity whose name
						// a question happens to contain, which is ranking by name overlap under
						// another name.
						sectionSummary: '',
						questionsThisExcerptCanAnswer: [],
						excerptKeywords: [],
						pointKind: 'entity',
						entityType: options.entityType,
						language: detectLanguage(matchText)
					}
				}
			: null;

	await deleteLorePage(deps.vectorClient, options.collectionName, {
		universeId: options.universeId,
		dataSourceId: options.dataSourceId,
		url,
		pointKind: 'body'
	});
	await upsertLoreChunks(
		deps.vectorClient,
		options.collectionName,
		entityPoint ? [...loreChunks, entityPoint] : loreChunks
	);

	return { chunkCount: loreChunks.length, entityPointWritten: entityPoint !== null };
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
