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
import {
	countLorePoints,
	createVectorClient,
	dropCollection,
	type QdrantClient
} from '@canonry/vector';
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
			entityType: 'place',
			entityMatchText: 'Valdoria Reach\ntype: place',
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		};

		const first = await indexEntity(deps, options);
		expect(first.chunkCount).toBeGreaterThan(0);
		expect(first.entityPointWritten).toBe(true);
		// One batch for the body chunks and the name text together, not one call each.
		expect(embedCalls).toBe(1);

		const hits = await retrieve(
			collectionName,
			u.id,
			'coastal trading city founded by exiled sailors'
		);
		expect(hits.some((h) => h.payload.url === entityLoreUrl(entityId))).toBe(true);
		expect(hits.every((h) => h.payload.dataSourceId === source.id)).toBe(true);
		expect(hits.every((h) => h.payload.universeId === u.id)).toBe(true);
		expect(hits.every((h) => h.payload.entityType === 'place')).toBe(true);

		// Re-save with a different, shorter body: the stale chunk(s) have to be replaced,
		// never left behind alongside the new one, and the entity point overwritten rather
		// than duplicated (`entityPointId` is derived, not random).
		const second = await indexEntity(deps, { ...options, body: 'Valdoria Reach is now a ruin.' });
		expect(second.chunkCount).toBeGreaterThan(0);

		const afterResave = await retrieve(collectionName, u.id, 'ruin');
		const pointsForEntity = afterResave.filter((h) => h.payload.url === entityLoreUrl(entityId));
		expect(pointsForEntity, 'no duplicate points left behind by the first save').toHaveLength(
			second.chunkCount + 1
		);
		expect(
			pointsForEntity.filter((h) => h.payload.pointKind === 'entity'),
			'exactly one entity-level point, however many times the entity is indexed'
		).toHaveLength(1);
		const bodyPoints = pointsForEntity.filter((h) => h.payload.pointKind === 'body');
		expect(bodyPoints).toHaveLength(second.chunkCount);
		expect(bodyPoints.every((h) => !h.payload.text.includes('Founded centuries'))).toBe(true);
	});

	it('a body emptied to nothing loses its chunks and keeps its entity point (issue #703)', async () => {
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
			entityType: 'place',
			entityMatchText: 'Thin Stub / Stubby\ntype: place',
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		};
		const scope = {
			universeId: u.id,
			dataSourceId: source.id,
			url: entityLoreUrl(entityId)
		};

		await indexEntity(deps, options);
		expect(
			(await retrieve(collectionName, u.id, 'something worth finding')).length
		).toBeGreaterThan(0);

		// Before #703 this call was a pure delete and the entity vanished from the index
		// entirely. The prose is gone, which is correct, and the entry is still findable by
		// name, which is the whole point of the second kind of point.
		const cleared = await indexEntity(deps, { ...options, body: '' });
		expect(cleared.chunkCount).toBe(0);
		expect(cleared.entityPointWritten).toBe(true);
		expect(
			await countLorePoints(vectorClient, collectionName, { ...scope, pointKind: 'body' })
		).toBe(0);
		expect(
			await countLorePoints(vectorClient, collectionName, { ...scope, pointKind: 'entity' })
		).toBe(1);

		const prose = await retrieve(collectionName, u.id, 'something worth finding');
		expect(prose.some((h) => h.payload.text.includes('worth finding'))).toBe(false);
		const byName = await retrieve(collectionName, u.id, 'Thin Stub Stubby');
		expect(byName.some((h) => h.payload.url === entityLoreUrl(entityId))).toBe(true);
	});

	it('deleteEntityLoreChunks removes both kinds of point, nothing about it left to retrieve', async () => {
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
			entityType: 'place',
			entityMatchText: 'Doomed Keep\ntype: place',
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

		// The entity itself is gone, so unlike an emptied body this takes the name point too.
		expect(
			await countLorePoints(vectorClient, collectionName, {
				universeId: u.id,
				dataSourceId: source.id,
				url: entityLoreUrl(entityId)
			})
		).toBe(0);
		expect(
			(await retrieve(collectionName, u.id, 'Doomed Keep guarded the mountain pass')).some(
				(h) => h.payload.url === entityLoreUrl(entityId)
			)
		).toBe(false);
	});

	it('finds an entity that has a name and aliases and no body at all (issue #703)', async () => {
		const { universe: u } = await insertUniverseWithOwner(db);
		const source = await ownCanonDataSource(db, u.id);
		const collectionName = scratchCollection();
		const entityId = randomUUID();
		const deps = { db, vectorClient, extractor: heuristicExtractor, embedder: hashingEmbedder };
		const query = 'Gilded Rat Tavern';

		// The state issue #703 exists for: a GM has named an entry and its aliases and written
		// no prose. Body-only indexing produced nothing at all for this entity, so the copilot
		// could not cite it - it existed in the wiki and was invisible to retrieval.
		const options = {
			dataSourceId: source.id,
			universeId: u.id,
			entityId,
			entityName: 'the Gilded Rat',
			body: '',
			entityType: 'place',
			entityMatchText: 'the Gilded Rat / Gilded Rat Tavern\ntype: place',
			collectionName,
			vectorSize: HASH_VECTOR_SIZE
		};

		// Before: the same entity, indexed the way this pipeline did it before #703, which for
		// an empty body is one delete and no write.
		await indexEntity(deps, { ...options, entityMatchText: '' });
		const before = await retrieve(collectionName, u.id, query);
		expect(before.some((h) => h.payload.url === entityLoreUrl(entityId))).toBe(false);

		// After: one entity-level point, and the entry answers to its own alias.
		const result = await indexEntity(deps, options);
		expect(result.chunkCount).toBe(0);
		expect(result.entityPointWritten).toBe(true);

		const after = await retrieve(collectionName, u.id, query);
		const hit = after.find((h) => h.payload.url === entityLoreUrl(entityId));
		expect(hit, 'a bodyless entry is retrievable by its name and aliases').toBeDefined();
		expect(hit?.payload.pointKind).toBe('entity');
		expect(hit?.payload.entityType).toBe('place');
		expect(hit?.payload.pageTitle).toBe('the Gilded Rat');
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
				entityType: 'place',
				entityMatchText: 'Ember Vault\ntype: place',
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
