/**
 * `unindexedEntities` against real Qdrant (issue #709).
 *
 * The point of these tests is not that a set difference works. It is that the enumeration is
 * **complete**: every state an entry can be in that leaves it out of retrieval has to come
 * back as missing, including the three that `canon_save_job`'s `no-embedding-model` rows
 * cannot see (a collection that does not exist at all, an entry indexed before entity points
 * existed, an entry whose write never went through the job queue). A wrong answer here leaves
 * an entry out of the copilot forever, so each of those is a test rather than an argument.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	createVectorClient,
	dropCollection,
	ensureCollection,
	upsertLoreChunks,
	upsertPoints,
	type LoreChunk,
	type LoreChunkPayload,
	type QdrantClient
} from '@canonry/vector';
import { unindexedEntities } from './entity-backfill.js';
import { entityLoreUrl } from './entity-pipeline.js';
import { chunkPointId, entityPointId } from './point-id.js';

const VECTOR_SIZE = 8;
const UNIVERSE = randomUUID();
const SOURCE = randomUUID();

let client: QdrantClient;
const createdCollections: string[] = [];

beforeAll(() => {
	client = createVectorClient();
});

afterEach(async () => {
	while (createdCollections.length > 0) {
		await dropCollection(client, createdCollections.pop()!).catch(() => undefined);
	}
});

async function scratchCollection(): Promise<string> {
	const name = `entity-backfill-test-${randomUUID()}`;
	createdCollections.push(name);
	await ensureCollection(client, { name, vectorSize: VECTOR_SIZE, onDimensionMismatch: 'throw' });
	return name;
}

function vector(seed: number): number[] {
	return Array.from({ length: VECTOR_SIZE }, (_, i) => (i === seed % VECTOR_SIZE ? 1 : 0));
}

function payload(overrides: Partial<LoreChunkPayload>): LoreChunkPayload {
	return {
		text: 'text',
		breadcrumb: 'Entry',
		pageTitle: 'Entry',
		url: 'canonry://entity/unset',
		pageUpdatedAt: '2026-01-01T00:00:00.000Z',
		indexedAt: '2026-01-01T00:00:00.000Z',
		universeId: UNIVERSE,
		dataSourceId: SOURCE,
		sectionSummary: '',
		questionsThisExcerptCanAnswer: [],
		excerptKeywords: [],
		pointKind: 'body',
		entityType: 'character',
		language: null,
		...overrides
	};
}

/** The point `indexEntity` writes for the entity itself - the one this enumeration reads. */
function entityPoint(entityId: string, seed = 1): LoreChunk {
	const url = entityLoreUrl(entityId);
	return {
		id: entityPointId(SOURCE, url),
		vector: vector(seed),
		payload: payload({ url, pointKind: 'entity' })
	};
}

/** A body chunk, which is every point a pre-#703 collection holds. */
function bodyChunk(entityId: string, index = 0, seed = 2): LoreChunk {
	const url = entityLoreUrl(entityId);
	return {
		id: chunkPointId(SOURCE, url, index),
		vector: vector(seed),
		payload: payload({ url, pointKind: 'body' })
	};
}

describe('unindexedEntities: the enumeration a backfill works from (issue #709)', () => {
	it('reports every entry as missing when the collection does not exist at all', async () => {
		// The ordinary state of a universe whose `embedding` row has been missing since it was
		// created: `indexEntity` never ran, so `ensureCollection` never ran either. A caught 404
		// read as "no points" would report a complete enumeration of nothing.
		const entityIds = [randomUUID(), randomUUID(), randomUUID()];
		const result = await unindexedEntities(
			{ vectorClient: client },
			{
				collectionName: `entity-backfill-absent-${randomUUID()}`,
				universeId: UNIVERSE,
				dataSourceId: SOURCE,
				entityIds
			}
		);
		expect(result.missing).toEqual(entityIds);
		expect(result.indexed).toBe(0);
		expect(result.orphanedPoints).toBe(0);
	});

	it('separates the entries that have an entity point from the ones that do not, keeping input order', async () => {
		const collectionName = await scratchCollection();
		const indexedIds = [randomUUID(), randomUUID()];
		const missingIds = [randomUUID(), randomUUID()];
		await upsertLoreChunks(
			client,
			collectionName,
			indexedIds.map((id, i) => entityPoint(id, i))
		);

		// Interleaved on purpose: the result has to be a subset in the caller's order, because the
		// caller orders by "newest change first" so the entries a GM touched last come back to
		// retrieval first.
		const entityIds = [missingIds[0]!, indexedIds[0]!, missingIds[1]!, indexedIds[1]!];
		const result = await unindexedEntities(
			{ vectorClient: client },
			{ collectionName, universeId: UNIVERSE, dataSourceId: SOURCE, entityIds }
		);
		expect(result.missing).toEqual(missingIds);
		expect(result.indexed).toBe(2);
		expect(result.orphanedPoints).toBe(0);
	});

	it('reports an entry that has body chunks and no entity point as missing', async () => {
		// Every entity indexed before #703 is in exactly this state, and its `canon_save_job` row
		// says `ok`. This is the case a job-row enumeration is structurally blind to.
		const collectionName = await scratchCollection();
		const legacyId = randomUUID();
		await upsertLoreChunks(client, collectionName, [
			bodyChunk(legacyId, 0),
			bodyChunk(legacyId, 1)
		]);

		const result = await unindexedEntities(
			{ vectorClient: client },
			{ collectionName, universeId: UNIVERSE, dataSourceId: SOURCE, entityIds: [legacyId] }
		);
		expect(result.missing).toEqual([legacyId]);
		expect(result.indexed).toBe(0);
	});

	it('reports an entry whose points carry no point_kind key at all as missing', async () => {
		// The genuinely legacy shape: a point written before `point_kind` existed, through the raw
		// points layer so no writer can add the key. `must: point_kind = 'entity'` cannot match it,
		// which is the correct answer here and the opposite of what the body filters in
		// `lore.ts` need - the asymmetry `indexedEntityUrls` documents.
		const collectionName = await scratchCollection();
		const legacyId = randomUUID();
		const url = entityLoreUrl(legacyId);
		await upsertPoints(client, collectionName, [
			{
				id: chunkPointId(SOURCE, url, 0),
				vector: vector(3),
				payload: { url, universe_id: UNIVERSE, data_source_id: SOURCE, text: 'old' }
			}
		]);

		const result = await unindexedEntities(
			{ vectorClient: client },
			{ collectionName, universeId: UNIVERSE, dataSourceId: SOURCE, entityIds: [legacyId] }
		);
		expect(result.missing).toEqual([legacyId]);
	});

	it('never counts another universe\u2019s entity point as this universe\u2019s', async () => {
		// One collection per (universe, model) is the norm, but SPEC.md §11.3's rule is that a read
		// filters by `universe_id` regardless, and an enumeration that leaked would report an entry
		// as indexed and leave it out of retrieval forever.
		const collectionName = await scratchCollection();
		const mine = randomUUID();
		const url = entityLoreUrl(mine);
		await upsertLoreChunks(client, collectionName, [
			{
				id: entityPointId(SOURCE, url),
				vector: vector(4),
				payload: payload({ url, pointKind: 'entity', universeId: randomUUID() })
			}
		]);

		const result = await unindexedEntities(
			{ vectorClient: client },
			{ collectionName, universeId: UNIVERSE, dataSourceId: SOURCE, entityIds: [mine] }
		);
		expect(result.missing).toEqual([mine]);
		expect(result.indexed).toBe(0);
	});

	it('counts an entity point with no entity behind it as orphaned rather than silently dropping it', async () => {
		const collectionName = await scratchCollection();
		const live = randomUUID();
		const deleted = randomUUID();
		await upsertLoreChunks(client, collectionName, [entityPoint(live, 1), entityPoint(deleted, 2)]);

		const result = await unindexedEntities(
			{ vectorClient: client },
			{ collectionName, universeId: UNIVERSE, dataSourceId: SOURCE, entityIds: [live] }
		);
		expect(result.missing).toEqual([]);
		expect(result.indexed).toBe(1);
		// `deleteEntityLoreChunks` was missed for that entity. Reported, not repaired.
		expect(result.orphanedPoints).toBe(1);
	});

	it('enumerates past one scroll page, so a large world is not silently truncated', async () => {
		// `ENTITY_URL_PAGE_SIZE` is 512, so this crosses the page boundary. A scroll that treated
		// a full page as the end would report 512 entries indexed and every one after that
		// missing, which is a backfill that re-embeds most of a world on every pass.
		const collectionName = await scratchCollection();
		const indexedIds = Array.from({ length: 600 }, () => randomUUID());
		for (let i = 0; i < indexedIds.length; i += 200) {
			await upsertLoreChunks(
				client,
				collectionName,
				indexedIds.slice(i, i + 200).map((id, j) => entityPoint(id, i + j))
			);
		}
		const stillMissing = randomUUID();

		const result = await unindexedEntities(
			{ vectorClient: client },
			{
				collectionName,
				universeId: UNIVERSE,
				dataSourceId: SOURCE,
				entityIds: [...indexedIds, stillMissing]
			}
		);
		expect(result.indexed).toBe(600);
		expect(result.missing).toEqual([stillMissing]);
		expect(result.orphanedPoints).toBe(0);
	});
});
