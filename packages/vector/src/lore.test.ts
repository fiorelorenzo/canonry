/**
 * Against the real Qdrant instance (issue #57 acceptance: "against the real Qdrant").
 * Every test creates its own scratch collection with a random suffix - this instance is
 * shared with whatever else is running against it, so a fixed name would collide - and
 * drops it afterwards.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createVectorClient } from './client.js';
import {
	collectionExists,
	dropCollection,
	ensureCollection,
	loreCollectionName
} from './collections.js';
import {
	countLorePoints,
	deleteLorePage,
	findPageUpdatedAt,
	queryLore,
	upsertLoreChunks,
	urlMatchesPattern,
	type LoreChunk,
	type LoreChunkPayload
} from './lore.js';
import { countPoints, upsertPoints } from './points.js';

const client = createVectorClient();
const VECTOR_SIZE = 8;

function unitVector(seed: number): number[] {
	// A deterministic, non-degenerate vector: mostly the seed dimension, small noise on
	// the rest, so near-duplicate points still have distinguishable cosine similarity.
	const vector = Array.from({ length: VECTOR_SIZE }, (_, i) =>
		i === seed % VECTOR_SIZE ? 1 : 0.01 * i
	);
	const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
	return vector.map((v) => v / norm);
}

function payload(overrides: Partial<LoreChunkPayload>): LoreChunkPayload {
	return {
		text: 'default text',
		breadcrumb: 'Page',
		pageTitle: 'Page',
		url: 'https://wiki.example.com/Page',
		pageUpdatedAt: '2026-01-01T00:00:00.000Z',
		indexedAt: '2026-01-02T00:00:00.000Z',
		universeId: 'universe-a',
		dataSourceId: 'source-1',
		sectionSummary: 'summary',
		questionsThisExcerptCanAnswer: ['What is this?'],
		excerptKeywords: ['keyword'],
		pointKind: 'body',
		entityType: null,
		language: null,
		...overrides
	};
}

const createdCollections: string[] = [];

function scratchCollectionName(): string {
	const name = `vector-test-${randomUUID()}`;
	createdCollections.push(name);
	return name;
}

afterEach(async () => {
	while (createdCollections.length > 0) {
		const name = createdCollections.pop()!;
		await dropCollection(client, name).catch(() => undefined);
	}
});

describe('loreCollectionName', () => {
	it('follows SPEC.md §11.3 exactly: UniverseLore_{provider}_{model}_{universeId}', () => {
		expect(loreCollectionName('openai', 'text-embedding-3-small', 'universe-42')).toBe(
			'UniverseLore_openai_text-embedding-3-small_universe-42'
		);
	});

	it('gives two different universes two different collection names for the same model', () => {
		const a = loreCollectionName('openai', 'text-embedding-3-small', 'universe-a');
		const b = loreCollectionName('openai', 'text-embedding-3-small', 'universe-b');
		expect(a).not.toBe(b);
	});
});

describe('ensureCollection against real Qdrant', () => {
	it('creates a collection with cosine distance and the requested vector size', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});

		expect(await collectionExists(client, name)).toBe(true);
		const info = await client.getCollection(name);
		const vectors = info.config.params.vectors as { size: number; distance: string };
		expect(vectors.size).toBe(VECTOR_SIZE);
		expect(vectors.distance).toBe('Cosine');
	});

	it('is idempotent: creating the same collection twice does not throw', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await expect(
			ensureCollection(client, { name, vectorSize: VECTOR_SIZE, onDimensionMismatch: 'recreate' })
		).resolves.toBeUndefined();
	});

	it('is idempotent under concurrency: several callers racing to create it all succeed (issue #709)', async () => {
		// Sequential idempotence was never the hard case. The exists-then-create pair is not
		// atomic, so callers that all find the collection absent all try to create it and Qdrant
		// answers every loser `409 Conflict`. It took two writes to a never-indexed universe inside
		// one debounce window to hit before; #709's backfill fans out N index jobs against exactly
		// that state, and the first end-to-end run of it lost two of six entries this way.
		const name = scratchCollectionName();
		const results = await Promise.allSettled(
			Array.from({ length: 6 }, () =>
				ensureCollection(client, { name, vectorSize: VECTOR_SIZE, onDimensionMismatch: 'throw' })
			)
		);
		const rejected = results.filter((result) => result.status === 'rejected');
		expect(rejected.map((result) => String(result.reason))).toEqual([]);
		expect(await collectionExists(client, name)).toBe(true);
		const info = await client.getCollection(name);
		const vectors = info.config.params.vectors as { size: number; distance: string };
		expect(vectors.size).toBe(VECTOR_SIZE);
	});

	it('still throws on a real width mismatch, including for a caller that lost the create race', async () => {
		// The `409` path must not become a way to skip the width check: the loser reads what the
		// winner made, and if that is the wrong width it has to say so rather than write into
		// something unreadable.
		const name = scratchCollectionName();
		await ensureCollection(client, { name, vectorSize: VECTOR_SIZE, onDimensionMismatch: 'throw' });
		await expect(
			ensureCollection(client, {
				name,
				vectorSize: VECTOR_SIZE * 2,
				onDimensionMismatch: 'throw'
			})
		).rejects.toThrow(/holds 8-dimension vectors/);
	});
});

describe('queryLore: cross-universe isolation', () => {
	it("never returns another universe's points even when they sit in the same collection with near-identical vectors", async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});

		const chunks: LoreChunk[] = [
			{
				id: randomUUID(),
				vector: unitVector(0),
				payload: payload({ universeId: 'universe-a', text: 'Valdoria is a coastal city.' })
			},
			{
				id: randomUUID(),
				vector: unitVector(0), // deliberately the same vector as universe A's point
				payload: payload({ universeId: 'universe-b', text: 'Cairnmouth is a coastal city.' })
			}
		];
		await upsertLoreChunks(client, name, chunks);

		const hitsForA = await queryLore(client, name, {
			vector: unitVector(0),
			universeId: 'universe-a',
			limit: 10
		});
		expect(hitsForA.length).toBeGreaterThan(0);
		for (const hit of hitsForA) {
			expect(hit.payload.universeId).toBe('universe-a');
		}

		const hitsForB = await queryLore(client, name, {
			vector: unitVector(0),
			universeId: 'universe-b',
			limit: 10
		});
		expect(hitsForB.length).toBeGreaterThan(0);
		for (const hit of hitsForB) {
			expect(hit.payload.universeId).toBe('universe-b');
		}

		// The two result sets never share a point id - proof the filter, not luck of the
		// vector search, is what kept them apart.
		const idsA = new Set(hitsForA.map((h) => h.id));
		const idsB = new Set(hitsForB.map((h) => h.id));
		for (const id of idsA) expect(idsB.has(id)).toBe(false);
	});

	it("a universe with no points never gets another universe's results back", async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{ id: randomUUID(), vector: unitVector(1), payload: payload({ universeId: 'universe-a' }) }
		]);

		const hits = await queryLore(client, name, {
			vector: unitVector(1),
			universeId: 'universe-empty',
			limit: 10
		});
		expect(hits).toEqual([]);
	});
});

describe('queryLore: exclusion patterns (issue #62)', () => {
	it('drops a hit whose url matches an excluded pattern', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(2),
				payload: payload({
					universeId: 'universe-a',
					url: 'https://wiki.example.com/Excluded_Page'
				})
			},
			{
				id: randomUUID(),
				vector: unitVector(2),
				payload: payload({ universeId: 'universe-a', url: 'https://wiki.example.com/Kept_Page' })
			}
		]);

		const hits = await queryLore(client, name, {
			vector: unitVector(2),
			universeId: 'universe-a',
			limit: 10,
			excludedUrlPatterns: ['https://wiki.example.com/Excluded_*']
		});

		expect(hits.map((h) => h.payload.url)).toEqual(['https://wiki.example.com/Kept_Page']);
	});
});

describe('urlMatchesPattern', () => {
	it('matches a wildcard prefix', () => {
		expect(urlMatchesPattern('https://wiki.example.com/A/B', 'https://wiki.example.com/*')).toBe(
			true
		);
	});

	it('matches an exact page url with no wildcard', () => {
		expect(
			urlMatchesPattern('https://wiki.example.com/Page', 'https://wiki.example.com/Page')
		).toBe(true);
		expect(
			urlMatchesPattern('https://wiki.example.com/Other', 'https://wiki.example.com/Page')
		).toBe(false);
	});
});

describe('deleteLorePage', () => {
	it("removes only the targeted page's points, scoped by universe, data source and url", async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(3),
				payload: payload({
					universeId: 'universe-a',
					dataSourceId: 'source-1',
					url: 'https://wiki.example.com/Stale'
				})
			},
			{
				id: randomUUID(),
				vector: unitVector(3),
				payload: payload({
					universeId: 'universe-a',
					dataSourceId: 'source-1',
					url: 'https://wiki.example.com/Fresh'
				})
			}
		]);

		await deleteLorePage(client, name, {
			universeId: 'universe-a',
			dataSourceId: 'source-1',
			url: 'https://wiki.example.com/Stale'
		});

		const hits = await queryLore(client, name, {
			vector: unitVector(3),
			universeId: 'universe-a',
			limit: 10
		});
		expect(hits.map((h) => h.payload.url)).toEqual(['https://wiki.example.com/Fresh']);
	});

	it("takes only the body points when scoped to 'body', leaving the entity point behind (issue #703)", async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		const url = 'canonry://entity/e1';
		const scope = { universeId: 'universe-a', dataSourceId: 'source-1', url };
		await upsertLoreChunks(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(3),
				payload: payload({ ...scope, text: 'body chunk', entityType: 'place' })
			},
			{
				id: randomUUID(),
				vector: unitVector(4),
				payload: payload({
					...scope,
					text: 'The Gilded Rat / Gilded Rat Tavern',
					pointKind: 'entity',
					entityType: 'place'
				})
			}
		]);

		await deleteLorePage(client, name, { ...scope, pointKind: 'body' });

		expect(await countLorePoints(client, name, scope)).toBe(1);
		expect(await countLorePoints(client, name, { ...scope, pointKind: 'body' })).toBe(0);
		const survivors = await queryLore(client, name, {
			vector: unitVector(4),
			universeId: 'universe-a',
			limit: 10
		});
		expect(survivors.map((h) => h.payload.pointKind)).toEqual(['entity']);
		expect(survivors[0]?.payload.entityType).toBe('place');
	});

	it("counts a point written before point_kind existed as a body point, and deletes it under 'body'", async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		const url = 'canonry://entity/legacy';
		const scope = { universeId: 'universe-a', dataSourceId: 'source-1', url };
		// Written the way every point in a deployed collection was written before issue #703:
		// through the generic points layer, with no `point_kind` key at all. A `must` on
		// `point_kind = 'body'` would match none of these and orphan every one of them, which
		// is why the body filter is a `must_not` on 'entity' instead.
		await upsertPoints(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(3),
				payload: {
					text: 'legacy chunk',
					breadcrumb: 'Page',
					page_title: 'Page',
					url,
					page_updated_at: '2026-01-01T00:00:00.000Z',
					indexed_at: '2026-01-02T00:00:00.000Z',
					universe_id: scope.universeId,
					data_source_id: scope.dataSourceId,
					section_summary: 'summary',
					questions_this_excerpt_can_answer: [],
					excerpt_keywords: [],
					language: null
				}
			}
		]);

		expect(await countLorePoints(client, name, { ...scope, pointKind: 'body' })).toBe(1);
		expect(await countLorePoints(client, name, { ...scope, pointKind: 'entity' })).toBe(0);

		await deleteLorePage(client, name, { ...scope, pointKind: 'body' });
		expect(await countLorePoints(client, name, scope)).toBe(0);
	});
});

describe('findPageUpdatedAt', () => {
	it('returns null for a page that has never been indexed', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		const result = await findPageUpdatedAt(client, name, {
			universeId: 'universe-a',
			dataSourceId: 'source-1',
			url: 'https://wiki.example.com/Never'
		});
		expect(result).toBeNull();
	});

	it("returns the stored page's own updatedAt once it has been indexed", async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(4),
				payload: payload({
					universeId: 'universe-a',
					dataSourceId: 'source-1',
					url: 'https://wiki.example.com/Seen',
					pageUpdatedAt: '2026-03-01T12:00:00.000Z'
				})
			}
		]);

		const result = await findPageUpdatedAt(client, name, {
			universeId: 'universe-a',
			dataSourceId: 'source-1',
			url: 'https://wiki.example.com/Seen'
		});
		expect(result).toBe('2026-03-01T12:00:00.000Z');
	});
});

describe('countPoints', () => {
	it('counts only points matching the filter', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{ id: randomUUID(), vector: unitVector(5), payload: payload({ universeId: 'universe-a' }) },
			{ id: randomUUID(), vector: unitVector(6), payload: payload({ universeId: 'universe-a' }) },
			{ id: randomUUID(), vector: unitVector(7), payload: payload({ universeId: 'universe-b' }) }
		]);

		const total = await countPoints(client, name);
		expect(total).toBe(3);
		const forA = await countPoints(client, name, {
			must: [{ key: 'universe_id', value: 'universe-a' }]
		});
		expect(forA).toBe(2);
	});
});

describe('LoreChunkPayload.language (SPEC.md §17, issue #125)', () => {
	it('round-trips a known language and a null (unknown) one through Qdrant unchanged', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(0),
				payload: payload({ url: 'https://wiki.example.com/En', language: 'en' })
			},
			{
				id: randomUUID(),
				vector: unitVector(1),
				payload: payload({ url: 'https://wiki.example.com/It', language: 'it' })
			},
			{
				id: randomUUID(),
				vector: unitVector(2),
				payload: payload({ url: 'https://wiki.example.com/Unknown', language: null })
			}
		]);

		const hits = await queryLore(client, name, {
			vector: unitVector(0),
			universeId: 'universe-a',
			limit: 10
		});
		const byUrl = new Map(hits.map((hit) => [hit.payload.url, hit.payload.language]));
		expect(byUrl.get('https://wiki.example.com/En')).toBe('en');
		expect(byUrl.get('https://wiki.example.com/It')).toBe('it');
		expect(byUrl.get('https://wiki.example.com/Unknown')).toBeNull();
	});

	it('is never a retrieval filter: a query returns chunks of every language present, not just one', async () => {
		const name = scratchCollectionName();
		await ensureCollection(client, {
			name,
			vectorSize: VECTOR_SIZE,
			onDimensionMismatch: 'recreate'
		});
		await upsertLoreChunks(client, name, [
			{
				id: randomUUID(),
				vector: unitVector(3),
				payload: payload({ url: 'https://wiki.example.com/English-page', language: 'en' })
			},
			{
				id: randomUUID(),
				// Deliberately the same vector as the English page: with a semantically-blind
				// vector, nothing but a language filter could ever separate the two, so a query
				// that gets both back proves `queryLore` applies no such filter.
				vector: unitVector(3),
				payload: payload({ url: 'https://wiki.example.com/Italian-page', language: 'it' })
			}
		]);

		const hits = await queryLore(client, name, {
			vector: unitVector(3),
			universeId: 'universe-a',
			limit: 10
		});
		const languages = new Set(hits.map((hit) => hit.payload.language));
		expect(languages).toEqual(new Set(['en', 'it']));
	});
});
