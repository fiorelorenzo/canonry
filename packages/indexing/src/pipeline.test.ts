/**
 * The full pipeline against real Qdrant and real Postgres (issue #58 acceptance): licence
 * gate refusal, incremental idempotent indexing, and (through `retrieveForUniverse`)
 * issue #62's exclusion list honoured at retrieval.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	closeDb,
	createDataSource,
	createSupersede,
	recordLicenceReview,
	type Db,
	LicenceNotReviewedError,
	addExclusion
} from '@canonry/db';
import { entity, user, universe } from '@canonry/db/schema';
import { createVectorClient, dropCollection, queryLore, type QdrantClient } from '@canonry/vector';
import { heuristicExtractor } from './extraction.js';
import { hashingEmbedder, type Embedder } from './embedding.js';
import { indexDataSource } from './pipeline.js';
import {
	keywordMatchCount,
	retrieveForUniverse,
	scoreLoreHits,
	KEYWORD_BOOST_PER_MATCH
} from './retriever.js';
import { MediaWikiClient } from './wiki-client.js';
import {
	startFixtureWikiServer,
	type FixtureWikiServer
} from './test-support/fixture-wiki-server.js';
import { openTestDb } from './test-db.js';

const HASH_VECTOR_SIZE = 256;

async function insertUniverseWithOwner(db: Db) {
	const [owner] = await db
		.insert(user)
		.values({
			id: randomUUID(),
			name: 'Test Owner',
			email: `${randomUUID()}@canonry.invalid`,
			emailVerified: true
		})
		.returning();
	const [row] = await db
		.insert(universe)
		.values({ ownerUserId: owner!.id, name: 'Test Universe', slug: randomUUID(), kind: 'homebrew' })
		.returning();
	return { owner: owner!, universe: row! };
}

let db: Db;
let vectorClient: QdrantClient;
let fixture: FixtureWikiServer | undefined;
const createdCollections: string[] = [];

beforeAll(() => {
	db = openTestDb();
	vectorClient = createVectorClient();
});

afterAll(async () => {
	await closeDb(db);
});

afterEach(async () => {
	await fixture?.close();
	fixture = undefined;
	while (createdCollections.length > 0) {
		await dropCollection(vectorClient, createdCollections.pop()!).catch(() => undefined);
	}
});

function scratchCollection(): string {
	const name = `pipeline-test-${randomUUID()}`;
	createdCollections.push(name);
	return name;
}

describe('indexDataSource: licence gate (issue #61)', () => {
	it('refuses to index a data source whose licence has never been reviewed', async () => {
		const { universe: u } = await insertUniverseWithOwner(db);
		const source = await createDataSource(db, {
			universeId: u.id,
			type: 'wiki',
			name: 'Unreviewed Wiki'
		});
		fixture = await startFixtureWikiServer([
			{ title: 'Page', wikitext: 'text', updatedAt: '2026-01-01T00:00:00.000Z' }
		]);
		const collectionName = scratchCollection();

		await expect(
			indexDataSource(
				{
					db,
					vectorClient,
					wikiClient: {
						listPageTitles: async () => ['Page'],
						getPage: async () => ({
							title: 'Page',
							url: 'https://wiki.example.com/Page',
							wikitext: 'text',
							updatedAt: new Date()
						})
					},
					extractor: heuristicExtractor,
					embedder: hashingEmbedder
				},
				{
					dataSourceId: source.id,
					universeId: u.id,
					collectionName,
					vectorSize: HASH_VECTOR_SIZE
				}
			)
		).rejects.toBeInstanceOf(LicenceNotReviewedError);
	});
});

describe('indexDataSource: crawl, chunk, extract, embed, upsert (issue #58)', () => {
	it('indexes a small fixture wiki end to end and is a no-op on an unchanged re-run', async () => {
		const { owner, universe: u } = await insertUniverseWithOwner(db);
		const source = await createDataSource(db, {
			universeId: u.id,
			type: 'wiki',
			name: 'Valdoria Wiki'
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: owner.id
		});

		fixture = await startFixtureWikiServer([
			{
				title: 'Valdoria Reach',
				wikitext:
					"'''Valdoria Reach''' is a coastal trading city.\n\n== History ==\nFounded centuries ago.",
				updatedAt: '2026-01-01T00:00:00.000Z'
			},
			{
				title: 'Cairnmouth',
				wikitext: "'''Cairnmouth''' is a northern port town.",
				updatedAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		const wikiClient = new MediaWikiClient({
			baseUrl: `${fixture.baseUrl}/api.php`,
			requestsPerSecond: 1000
		});
		const collectionName = scratchCollection();

		let extractCalls = 0;
		let embedCalls = 0;
		const countingExtractor: typeof heuristicExtractor = async (input) => {
			extractCalls += 1;
			return heuristicExtractor(input);
		};
		const countingEmbedder: Embedder = async (texts) => {
			embedCalls += 1;
			return hashingEmbedder(texts);
		};

		const deps = {
			db,
			vectorClient,
			wikiClient,
			extractor: countingExtractor,
			embedder: countingEmbedder
		};
		const options = {
			dataSourceId: source.id,
			universeId: u.id,
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		};

		const first = await indexDataSource(deps, options);
		expect(first.pagesIndexed).toBe(2);
		expect(first.pagesSkipped).toBe(0);
		expect(first.totalChunkCount).toBeGreaterThan(0);
		expect(extractCalls).toBeGreaterThan(0);
		expect(embedCalls).toBeGreaterThan(0);

		// Re-index with nothing changed: both pages must be a no-op - no extraction, no
		// embedding, no chunking, no upsert calls.
		extractCalls = 0;
		embedCalls = 0;
		const second = await indexDataSource(deps, options);
		expect(second.pagesIndexed).toBe(0);
		expect(second.pagesSkipped).toBe(2);
		expect(second.totalChunkCount).toBe(first.totalChunkCount);
		expect(extractCalls).toBe(0);
		expect(embedCalls).toBe(0);

		// Editing one page re-indexes only that page.
		fixture.setPage({
			title: 'Cairnmouth',
			wikitext: "'''Cairnmouth''' is a northern port town, rebuilt after the storm.",
			updatedAt: '2026-06-01T00:00:00.000Z'
		});
		const third = await indexDataSource(deps, options);
		expect(third.pagesIndexed).toBe(1);
		expect(third.pagesSkipped).toBe(1);
	});

	it("tags each chunk's payload with its own detected language (SPEC.md §17, issue #125), never the page's or the universe's", async () => {
		const { owner, universe: u } = await insertUniverseWithOwner(db);
		const source = await createDataSource(db, {
			universeId: u.id,
			type: 'wiki',
			name: 'Bilingual Wiki'
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: owner.id
		});

		fixture = await startFixtureWikiServer([
			{
				title: 'English Page',
				wikitext:
					'The city is a coastal trading post that has grown for centuries. After the war, the docks were rebuilt and the market began to grow again, and the people who live there now trade with their neighbors.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			},
			{
				title: 'Pagina Italiana',
				wikitext:
					'La città è un porto molto antico, e i suoi mercanti commerciano con le città vicine da secoli. Dopo la grande tempesta, la popolazione ha ricostruito le banchine e il mercato è tornato a crescere.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		const wikiClient = new MediaWikiClient({
			baseUrl: `${fixture.baseUrl}/api.php`,
			requestsPerSecond: 1000
		});
		const collectionName = scratchCollection();

		await indexDataSource(
			{ db, vectorClient, wikiClient, extractor: heuristicExtractor, embedder: hashingEmbedder },
			{ dataSourceId: source.id, universeId: u.id, collectionName, vectorSize: HASH_VECTOR_SIZE }
		);

		const [queryVector] = await hashingEmbedder(['city']);
		const hits = await queryLore(vectorClient, collectionName, {
			vector: queryVector!,
			universeId: u.id,
			limit: 10
		});
		const languageByPage = new Map(
			hits.map((hit) => [hit.payload.pageTitle, hit.payload.language])
		);
		expect(languageByPage.get('English Page')).toBe('en');
		expect(languageByPage.get('Pagina Italiana')).toBe('it');
	});
});

describe('retrieveForUniverse: exclusion list honoured at retrieval (issue #62)', () => {
	it('never returns a chunk from an excluded url', async () => {
		const { owner, universe: u } = await insertUniverseWithOwner(db);
		const source = await createDataSource(db, {
			universeId: u.id,
			type: 'wiki',
			name: 'Excludable Wiki'
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: owner.id
		});

		fixture = await startFixtureWikiServer([
			{
				title: 'Kept Page',
				wikitext: 'Valdoria Reach is a coastal trading city with a busy harbour.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			},
			{
				title: 'Excluded Page',
				wikitext: 'Valdoria Reach is a coastal trading city with a busy harbour, spoiler edition.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		const wikiClient = new MediaWikiClient({
			baseUrl: `${fixture.baseUrl}/api.php`,
			requestsPerSecond: 1000
		});
		const collectionName = scratchCollection();

		const result = await indexDataSource(
			{ db, vectorClient, wikiClient, extractor: heuristicExtractor, embedder: hashingEmbedder },
			{ dataSourceId: source.id, universeId: u.id, collectionName, vectorSize: HASH_VECTOR_SIZE }
		);
		expect(result.pagesIndexed).toBe(2);

		const excludedPageUrl = (await wikiClient.getPage('Excluded Page')).url;
		const [queryVector] = await hashingEmbedder(['coastal trading city harbour']);

		const beforeExclusion = await retrieveForUniverse({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText: 'coastal trading city harbour',
			topK: 10,
			threshold: -1
		});
		expect(beforeExclusion.some((hit) => hit.payload.url === excludedPageUrl)).toBe(true);

		await addExclusion(db, { dataSourceId: source.id, urlPattern: excludedPageUrl });

		const afterExclusion = await retrieveForUniverse({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText: 'coastal trading city harbour',
			topK: 10,
			threshold: -1
		});
		expect(afterExclusion.some((hit) => hit.payload.url === excludedPageUrl)).toBe(false);
		expect(afterExclusion.length).toBeGreaterThan(0);

		// A global (no data source) pattern also excludes, everywhere.
		const scored = await scoreLoreHits({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText: 'coastal trading city harbour'
		});
		expect(scored.every((hit) => hit.payload.url !== excludedPageUrl)).toBe(true);
	});
});

describe('scoreLoreHits: the keyword boost is a parameter, not a baked-in constant (issue #278)', () => {
	it('scores the same hit lower with no boost than with the shipped one, by the match count times the difference', async () => {
		const { owner, universe: u } = await insertUniverseWithOwner(db);
		const source = await createDataSource(db, {
			universeId: u.id,
			type: 'wiki',
			name: 'Boostable Wiki'
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: owner.id
		});

		fixture = await startFixtureWikiServer([
			{
				title: 'Harbour',
				wikitext:
					'The harbour is the busiest harbour on the coast. Every harbour master keeps a ledger, ' +
					'and the ledger of this harbour is famously incomplete.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		const wikiClient = new MediaWikiClient({
			baseUrl: `${fixture.baseUrl}/api.php`,
			requestsPerSecond: 1000
		});
		const collectionName = scratchCollection();
		await indexDataSource(
			{ db, vectorClient, wikiClient, extractor: heuristicExtractor, embedder: hashingEmbedder },
			{ dataSourceId: source.id, universeId: u.id, collectionName, vectorSize: HASH_VECTOR_SIZE }
		);

		const queryText = 'harbour ledger';
		const [queryVector] = await hashingEmbedder([queryText]);
		const common = {
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText
		};

		const unboosted = await scoreLoreHits({ ...common, keywordBoostPerMatch: 0 });
		const boosted = await scoreLoreHits(common);
		expect(unboosted.length).toBeGreaterThan(0);

		const hit = unboosted[0]!;
		const boostedHit = boosted.find((h) => h.chunkId === hit.chunkId);
		const matches = keywordMatchCount(queryText, hit.payload.excerptKeywords);
		// The boost has to actually be doing something on this chunk, or the assertion below
		// would pass on two identical numbers and prove nothing.
		expect(matches).toBeGreaterThan(0);
		expect(boostedHit?.score).toBeCloseTo(hit.score + matches * KEYWORD_BOOST_PER_MATCH, 6);
	});
});

describe('retrieveForUniverse: supersede honoured at retrieval (issue #19)', () => {
	it('never returns a chunk from a page a universe has declared it supersedes', async () => {
		const { owner, universe: u } = await insertUniverseWithOwner(db);
		const source = await createDataSource(db, {
			universeId: u.id,
			type: 'wiki',
			name: 'Forgotten Realms'
		});
		await recordLicenceReview(db, {
			dataSourceId: source.id,
			licence: 'CC BY-SA 3.0',
			reviewedBy: owner.id
		});

		fixture = await startFixtureWikiServer([
			{
				title: 'Waterdeep',
				wikitext: 'Waterdeep is ruled by the Masked Lords, a council kept anonymous.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			},
			{
				title: 'Skullport',
				wikitext: 'Skullport is a lawless port city beneath Waterdeep, ruled by no one.',
				updatedAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		const wikiClient = new MediaWikiClient({
			baseUrl: `${fixture.baseUrl}/api.php`,
			requestsPerSecond: 1000
		});
		const collectionName = scratchCollection();

		await indexDataSource(
			{ db, vectorClient, wikiClient, extractor: heuristicExtractor, embedder: hashingEmbedder },
			{ dataSourceId: source.id, universeId: u.id, collectionName, vectorSize: HASH_VECTOR_SIZE }
		);

		const waterdeepUrl = (await wikiClient.getPage('Waterdeep')).url;
		const [queryVector] = await hashingEmbedder(['Masked Lords council anonymous ruled']);

		const beforeSupersede = await retrieveForUniverse({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText: 'Masked Lords council anonymous ruled',
			topK: 10,
			threshold: -1
		});
		expect(beforeSupersede.some((hit) => hit.payload.url === waterdeepUrl)).toBe(true);

		// The GM diverges from the published setting: their own Waterdeep entry
		// supersedes the official page, so it must stop coming back from retrieval.
		const [ourEntity] = await db
			.insert(entity)
			.values({
				universeId: u.id,
				type: 'place',
				name: 'Waterdeep',
				slug: 'waterdeep',
				body: 'Ours diverges: the Masked Lords are a fiction the guilds maintain.'
			})
			.returning();
		await createSupersede(db, {
			universeId: u.id,
			entityId: ourEntity!.id,
			dataSourceId: source.id,
			sourceUrl: waterdeepUrl
		});

		const afterSupersede = await retrieveForUniverse({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			queryVector: queryVector!,
			queryText: 'Masked Lords council anonymous ruled',
			topK: 10,
			threshold: -1
		});
		expect(afterSupersede.some((hit) => hit.payload.url === waterdeepUrl)).toBe(false);

		// A different universe reading the same collection (the derived-universe shape:
		// `universeId` matches where the chunks live, `policyUniverseId` is whichever
		// universe's own declarations should apply) still gets the page back when *that*
		// universe never declared the supersede - the user's canon always wins for the
		// universe that diverged, not for retrieval globally.
		const { universe: otherUniverse } = await insertUniverseWithOwner(db);
		const stillSees = await retrieveForUniverse({
			db,
			vectorClient,
			collectionName,
			universeId: u.id,
			policyUniverseId: otherUniverse.id,
			queryVector: queryVector!,
			queryText: 'Masked Lords council anonymous ruled',
			topK: 10,
			threshold: -1
		});
		expect(stillSees.some((hit) => hit.payload.url === waterdeepUrl)).toBe(true);
	});
});
