/**
 * `indexEntity`/`deleteEntityLoreChunks` against real Qdrant and real Postgres (issue
 * #164 acceptance): saving an entity puts retrievable chunks in that universe's
 * collection, a re-save replaces rather than duplicates them, a delete removes them, and
 * a chunk written for one universe is never retrievable from another (SPEC.md §11.3).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, ownCanonDataSource, type Db } from '@canonry/db';
import { user, universe } from '@canonry/db/schema';
import { createVectorClient, dropCollection, type QdrantClient } from '@canonry/vector';
import { heuristicExtractor } from './extraction.js';
import { hashingEmbedder, type Embedder } from './embedding.js';
import { deleteEntityLoreChunks, entityLoreUrl, indexEntity } from './entity-pipeline.js';
import { retrieveForUniverse } from './retriever.js';
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
const createdCollections: string[] = [];

beforeAll(() => {
	db = openTestDb();
	vectorClient = createVectorClient();
});

afterAll(async () => {
	await closeDb(db);
});

afterEach(async () => {
	while (createdCollections.length > 0) {
		await dropCollection(vectorClient, createdCollections.pop()!).catch(() => undefined);
	}
});

function scratchCollection(): string {
	const name = `entity-pipeline-test-${randomUUID()}`;
	createdCollections.push(name);
	return name;
}

/** `retrieveForUniverse` at a threshold below any real cosine score, so a scratch test
 * corpus of one or two short entities is never filtered out by SPEC.md §11.4's tuned
 * threshold - the point here is retrieval correctness, not the threshold itself. */
async function retrieve(collectionName: string, universeId: string, queryText: string) {
	const [queryVector] = await hashingEmbedder([queryText]);
	return retrieveForUniverse({
		db,
		vectorClient,
		collectionName,
		universeId,
		queryVector: queryVector!,
		queryText,
		topK: 20,
		threshold: -1
	});
}

describe('indexEntity: a save puts retrievable chunks in the universe collection (issue #164)', () => {
	it('indexes a saved entity into retrievable chunks, and a re-save replaces rather than duplicates them', async () => {
		const { universe: u } = await insertUniverseWithOwner(db);
		const source = await ownCanonDataSource(db, u.id);
		const collectionName = scratchCollection();
		const entityId = randomUUID();

		let embedCalls = 0;
		const countingEmbedder: Embedder = async (texts) => {
			embedCalls += 1;
			return hashingEmbedder(texts);
		};

		const deps = { db, vectorClient, extractor: heuristicExtractor, embedder: countingEmbedder };
		const options = {
			dataSourceId: source.id,
			universeId: u.id,
			entityId,
			entityName: 'Valdoria Reach',
			body: 'Valdoria Reach is a coastal trading city.\n\n== History ==\nFounded centuries ago by exiled sailors.',
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		};

		const first = await indexEntity(deps, options);
		expect(first.chunkCount).toBeGreaterThan(0);
		expect(embedCalls).toBeGreaterThan(0);

		const hits = await retrieve(
			collectionName,
			u.id,
			'coastal trading city founded by exiled sailors'
		);
		expect(hits.some((h) => h.payload.url === entityLoreUrl(entityId))).toBe(true);
		expect(hits.every((h) => h.payload.dataSourceId === source.id)).toBe(true);
		expect(hits.every((h) => h.payload.universeId === u.id)).toBe(true);

		// Re-save with a different, shorter body: the stale chunk(s) have to be replaced,
		// never left behind alongside the new one.
		const second = await indexEntity(deps, { ...options, body: 'Valdoria Reach is now a ruin.' });
		expect(second.chunkCount).toBeGreaterThan(0);

		const afterResave = await retrieve(collectionName, u.id, 'ruin');
		const pointsForEntity = afterResave.filter((h) => h.payload.url === entityLoreUrl(entityId));
		expect(pointsForEntity, 'no duplicate points left behind by the first save').toHaveLength(
			second.chunkCount
		);
		expect(pointsForEntity.every((h) => !h.payload.text.includes('Founded centuries'))).toBe(true);
	});

	it('a save with an empty body indexes nothing and deletes whatever this entity had before', async () => {
		const { universe: u } = await insertUniverseWithOwner(db);
		const source = await ownCanonDataSource(db, u.id);
		const collectionName = scratchCollection();
		const entityId = randomUUID();
		const deps = { db, vectorClient, extractor: heuristicExtractor, embedder: hashingEmbedder };
		const options = {
			dataSourceId: source.id,
			universeId: u.id,
			entityId,
			entityName: 'Thin Stub',
			body: 'Something worth finding, once.',
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		};

		await indexEntity(deps, options);
		expect(
			(await retrieve(collectionName, u.id, 'something worth finding')).length
		).toBeGreaterThan(0);

		const cleared = await indexEntity(deps, { ...options, body: '' });
		expect(cleared.chunkCount).toBe(0);
		const hits = await retrieve(collectionName, u.id, 'something worth finding');
		expect(hits.some((h) => h.payload.url === entityLoreUrl(entityId))).toBe(false);
	});

	it('deleteEntityLoreChunks removes an entity’s points, nothing about it left to retrieve', async () => {
		const { universe: u } = await insertUniverseWithOwner(db);
		const source = await ownCanonDataSource(db, u.id);
		const collectionName = scratchCollection();
		const entityId = randomUUID();
		const deps = { db, vectorClient, extractor: heuristicExtractor, embedder: hashingEmbedder };

		await indexEntity(deps, {
			dataSourceId: source.id,
			universeId: u.id,
			entityId,
			entityName: 'Doomed Keep',
			body: 'The Doomed Keep once guarded the mountain pass.',
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		});
		expect(
			(await retrieve(collectionName, u.id, 'Doomed Keep guarded the mountain pass')).some(
				(h) => h.payload.url === entityLoreUrl(entityId)
			)
		).toBe(true);

		await deleteEntityLoreChunks(
			{ vectorClient },
			{ collectionName, universeId: u.id, dataSourceId: source.id, entityId }
		);

		expect(
			(await retrieve(collectionName, u.id, 'Doomed Keep guarded the mountain pass')).some(
				(h) => h.payload.url === entityLoreUrl(entityId)
			)
		).toBe(false);
	});
});

describe('indexEntity: cross-universe isolation (SPEC.md §11.3, issue #164)', () => {
	it('a chunk written for one universe is never retrievable from another, even reading the same collection', async () => {
		const { universe: a } = await insertUniverseWithOwner(db);
		const { universe: b } = await insertUniverseWithOwner(db);
		const sourceA = await ownCanonDataSource(db, a.id);
		const collectionName = scratchCollection();

		await indexEntity(
			{ db, vectorClient, extractor: heuristicExtractor, embedder: hashingEmbedder },
			{
				dataSourceId: sourceA.id,
				universeId: a.id,
				entityId: randomUUID(),
				entityName: 'Ember Vault',
				body: 'The Ember Vault holds the last dragon egg in the kingdom.',
				collectionName,
				vectorSize: HASH_VECTOR_SIZE
			}
		);

		const asOwner = await retrieve(collectionName, a.id, 'dragon egg kept in the Ember Vault');
		expect(asOwner.length).toBeGreaterThan(0);

		// Universe B reads the very same collection (the theoretical risk SPEC.md §11.3
		// calls a bug) with its own id - `queryLore`'s mandatory `universe_id` filter has
		// to be what stands between it and universe A's chunk, not physical separation.
		const asOtherUniverse = await retrieve(
			collectionName,
			b.id,
			'dragon egg kept in the Ember Vault'
		);
		expect(asOtherUniverse).toEqual([]);
	});
});
