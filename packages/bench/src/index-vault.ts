/**
 * Indexes a directory of markdown notes into a universe's own lore collection as a real
 * `data_source`, through `indexDataSource` (issue #278).
 *
 * This is the second half of the corpus the retrieval sweep needs. `index-corpus.ts` puts
 * the universe's own canon in through `indexEntity`; this puts an imported source in
 * through the crawl pipeline, into the same per-universe collection, because that is the
 * one collection `packages/copilot`'s `searchIndexed` queries. Issue #278's whole question
 * is what top-k and the threshold do once those two layers compete inside it, which cannot
 * be asked of a universe that only has one of them.
 *
 * The licence review is recorded rather than bypassed: `requireIndexableDataSource` is
 * issue #61's enforcement point and the bench has no business going around it. Valdris is
 * CC BY-SA 4.0, which is why the corpus itself stays out of this repo (AGPL-3.0, and
 * share-alike text does not belong inside it) and is cloned into `.data/` instead.
 */
import { and, createDataSource, eq, recordLicenceReview, type Db } from '@canonry/db';
import { dataSource } from '@canonry/db/schema';
import { resolveModel } from '@canonry/ai';
import { embeddingDimensionsFor, heuristicExtractor, indexDataSource } from '@canonry/indexing';
import { createVectorClient, loreCollectionNameForModel } from '@canonry/vector';
import { benchEmbedder } from './embedder.js';
import { BENCH_USER_ID } from './fixture.js';
import { VaultWikiClient } from './corpus/vault.js';

/** github.com/offendingcommit/valdris, the world `scripts/build-demo-corpus.mjs` (issue
 * #257) already renders into the import formats. Cloned into `.data/corpus/valdris`. */
export const VALDRIS_SOURCE_NAME = 'Valdris (community vault)';
const VALDRIS_URL = 'https://github.com/offendingcommit/valdris';
const VALDRIS_PAGE_URL_BASE = 'https://valdris.example/wiki';

export interface IndexedVault {
	dataSourceId: string;
	collection: string;
	pages: number;
	chunks: number;
}

export interface IndexVaultOptions {
	/** Directory holding the markdown notes. */
	dir: string;
	/** Write into this collection instead of the universe's own. Used by a repeat run that
	 * needs its own vectors rather than the ones a previous run left behind. */
	collectionName?: string;
	/** Serve only the largest N notes, for a cheaper smoke run. */
	limit?: number;
}

export async function indexVault(
	db: Db,
	universeId: string,
	options: IndexVaultOptions
): Promise<IndexedVault> {
	const existing = await db
		.select({ id: dataSource.id })
		.from(dataSource)
		.where(and(eq(dataSource.universeId, universeId), eq(dataSource.name, VALDRIS_SOURCE_NAME)))
		.limit(1);

	let dataSourceId = existing[0]?.id;
	if (!dataSourceId) {
		const created = await createDataSource(db, {
			universeId,
			type: 'wiki',
			name: VALDRIS_SOURCE_NAME,
			url: VALDRIS_URL,
			config: { vault: options.dir }
		});
		dataSourceId = created.id;
	}
	await recordLicenceReview(db, {
		dataSourceId,
		licence: 'CC BY-SA 4.0',
		licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
		reviewedBy: BENCH_USER_ID,
		notes:
			'Community worldbuilding vault, CC BY-SA 4.0, attributed to offendingcommit/valdris. ' +
			'Indexed for measurement only; the corpus is not redistributed from this repository.'
	});

	const embeddingModel = await resolveModel(db, 'embedding');
	const collectionName =
		options.collectionName ?? loreCollectionNameForModel(embeddingModel, universeId);
	const result = await indexDataSource(
		{
			db,
			vectorClient: createVectorClient(),
			wikiClient: new VaultWikiClient({
				dir: options.dir,
				urlBase: VALDRIS_PAGE_URL_BASE,
				...(options.limit === undefined ? {} : { limit: options.limit })
			}),
			extractor: heuristicExtractor,
			embedder: await benchEmbedder(db, universeId)
		},
		{
			dataSourceId,
			universeId,
			collectionName,
			vectorSize: embeddingDimensionsFor(embeddingModel.provider, embeddingModel.modelId)
		}
	);

	return {
		dataSourceId,
		collection: collectionName,
		pages: result.pages.length,
		chunks: result.totalChunkCount
	};
}
