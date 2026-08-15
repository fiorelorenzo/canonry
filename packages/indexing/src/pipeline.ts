/**
 * The crawl -> chunk -> extract -> embed -> upsert pipeline (SPEC.md §7/§11.3, issue
 * #58). Every dependency is injected - the wiki client, the extractor, the embedder, the
 * Qdrant client - so the same function runs against a real wiki and real models in
 * production, and against a fixture server with deterministic extractor/embedder
 * implementations in tests, with no branch anywhere for "is this a test".
 */
import type { Db } from '@canonry/db';
import {
	markIndexed,
	markIndexingFailed,
	markIndexingStarted,
	requireIndexableDataSource
} from '@canonry/db';
import {
	countPoints,
	deleteLorePage,
	ensureCollection,
	findPageUpdatedAt,
	upsertLoreChunks,
	type LoreChunk,
	type QdrantClient
} from '@canonry/vector';
import { detectLanguage } from '@canonry/lang';
import { chunkWikiPage, DEFAULT_CHUNK_TOKEN_BUDGET } from './chunking.js';
import type { ChunkExtractor } from './extraction.js';
import type { Embedder } from './embedding.js';
import { chunkPointId } from './point-id.js';
import type { WikiClient } from './wiki-client.js';

export interface IndexDataSourcePageDeps {
	wikiClient: WikiClient;
	extractor: ChunkExtractor;
	embedder: Embedder;
}

export interface IndexDataSourceDeps extends IndexDataSourcePageDeps {
	db: Db;
	vectorClient: QdrantClient;
}

export interface IndexDataSourceOptions {
	dataSourceId: string;
	/** Which universe's collection this run writes into. Explicit rather than read off
	 * `data_source.universe_id` because that column is nullable for a shared official
	 * corpus (source.ts's own comment) - the caller decides the target collection either
	 * way, this pipeline only writes to the one it is given. */
	universeId: string;
	collectionName: string;
	vectorSize: number;
	chunkTokenBudget?: number;
}

export interface IndexPageOutcome {
	title: string;
	url: string;
	skipped: boolean;
	chunkCount: number;
}

export interface IndexDataSourceResult {
	pages: IndexPageOutcome[];
	pagesIndexed: number;
	pagesSkipped: number;
	/** The data source's total point count after this run, across every page it has ever
	 * indexed - not just the pages this run touched (issue #58's incremental crawl means
	 * most runs touch only a handful). */
	totalChunkCount: number;
}

/** Indexes one page if (and only if) it changed since the last run - the idempotency
 * check of issue #58: an unchanged page's `updatedAt` compares equal to what is already
 * stored, and the pipeline makes zero extractor/embedder/Qdrant-write calls for it. */
async function indexPage(
	deps: IndexDataSourcePageDeps & { db: Db; vectorClient: QdrantClient },
	options: IndexDataSourceOptions,
	title: string
): Promise<IndexPageOutcome> {
	const page = await deps.wikiClient.getPage(title);
	const pageUpdatedAt = page.updatedAt.toISOString();

	const existingUpdatedAt = await findPageUpdatedAt(deps.vectorClient, options.collectionName, {
		universeId: options.universeId,
		dataSourceId: options.dataSourceId,
		url: page.url
	});
	if (existingUpdatedAt === pageUpdatedAt) {
		return { title: page.title, url: page.url, skipped: true, chunkCount: 0 };
	}

	const wikiChunks = chunkWikiPage(page.title, page.wikitext, {
		tokenBudget: options.chunkTokenBudget ?? DEFAULT_CHUNK_TOKEN_BUDGET
	});

	const metadata = await Promise.all(
		wikiChunks.map((chunk) =>
			deps.extractor({ pageTitle: page.title, breadcrumb: chunk.breadcrumb, text: chunk.text })
		)
	);
	const vectors = await deps.embedder(wikiChunks.map((chunk) => chunk.text));

	const indexedAt = new Date().toISOString();
	const loreChunks: LoreChunk[] = wikiChunks.map((chunk, i) => {
		const chunkMetadata = metadata[i]!;
		return {
			id: chunkPointId(options.dataSourceId, page.url, chunk.index),
			vector: vectors[i]!,
			payload: {
				text: chunk.text,
				breadcrumb: chunk.breadcrumb,
				pageTitle: page.title,
				url: page.url,
				pageUpdatedAt,
				indexedAt,
				universeId: options.universeId,
				dataSourceId: options.dataSourceId,
				sectionSummary: chunkMetadata.sectionSummary,
				questionsThisExcerptCanAnswer: chunkMetadata.questionsThisExcerptCanAnswer,
				excerptKeywords: chunkMetadata.excerptKeywords,
				// SPEC.md §17, issue #125: the chunk's own language, detected from its own
				// text (not the page's, not the universe's - a page can be mixed), so a future
				// ranking change has it to read. `detectLanguage` is the same conservative
				// heuristic an entry's `language` column uses: null for short text, a roster of
				// names, or a genuinely mixed passage. Never fed into `queryLore`'s filter -
				// see `LoreChunkPayload.language`'s own doc comment for why.
				language: detectLanguage(chunk.text)
			}
		};
	});

	// Stale chunks first, in case this page shrank since the last run and would
	// otherwise leave orphaned points at indices past the new chunk count.
	await deleteLorePage(deps.vectorClient, options.collectionName, {
		universeId: options.universeId,
		dataSourceId: options.dataSourceId,
		url: page.url
	});
	await upsertLoreChunks(deps.vectorClient, options.collectionName, loreChunks);

	return { title: page.title, url: page.url, skipped: false, chunkCount: loreChunks.length };
}

/**
 * Indexes every page of a data source's wiki, incrementally and idempotently. Refuses to
 * run at all unless `requireIndexableDataSource` (issue #61's enforcement point) clears
 * the source first - a data source whose licence has not been reviewed never reaches the
 * crawl, let alone the pipeline's other steps.
 */
export async function indexDataSource(
	deps: IndexDataSourceDeps,
	options: IndexDataSourceOptions
): Promise<IndexDataSourceResult> {
	await requireIndexableDataSource(deps.db, options.dataSourceId);
	await markIndexingStarted(deps.db, options.dataSourceId);

	try {
		await ensureCollection(deps.vectorClient, {
			name: options.collectionName,
			vectorSize: options.vectorSize,
			// Indexed lore is the product of a real crawl, so a width change is a re-index someone
			// has to ask for, never something this pipeline destroys on its own initiative.
			onDimensionMismatch: 'throw'
		});

		const titles = await deps.wikiClient.listPageTitles();
		const pages: IndexPageOutcome[] = [];
		for (const title of titles) {
			pages.push(await indexPage(deps, options, title));
		}

		const totalChunkCount = await countPoints(deps.vectorClient, options.collectionName, {
			must: [
				{ key: 'universe_id', value: options.universeId },
				{ key: 'data_source_id', value: options.dataSourceId }
			]
		});

		await markIndexed(deps.db, options.dataSourceId, { chunkCount: totalChunkCount });

		return {
			pages,
			pagesIndexed: pages.filter((p) => !p.skipped).length,
			pagesSkipped: pages.filter((p) => p.skipped).length,
			totalChunkCount
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await markIndexingFailed(deps.db, options.dataSourceId, message);
		throw error;
	}
}
