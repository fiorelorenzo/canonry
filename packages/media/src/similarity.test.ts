/**
 * Against the real Qdrant instance this box runs (127.0.0.1:56333 via @canonry/vector's
 * own default) - no mock, no fake vector store. Uses FakeEmbeddingProvider's deterministic
 * trigram vectors directly rather than going through a network embedding call, since this
 * file is about the cache mechanics (threshold, universe/feature scoping, point payload
 * round trip), not about embedding quality.
 */
import { randomUUID } from 'node:crypto';
import { createVectorClient } from '@canonry/vector';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trigramEmbedding } from './embedding.js';
import {
	findSimilarMedia,
	recordMediaVector,
	type SimilarityCacheDeps,
	mediaSimilarityCollectionName
} from './similarity.js';

const VECTOR_SIZE = 256;

describe('similarity cache (#67, against real Qdrant)', () => {
	let deps: SimilarityCacheDeps;
	// Unique per test run so concurrent suites never see each other's points, without
	// ever having to drop the shared MediaPromptSimilarity collection itself.
	const universeId = `similarity-test-${randomUUID()}`;

	beforeAll(() => {
		deps = {
			client: createVectorClient(),
			vectorSize: VECTOR_SIZE,
			collection: mediaSimilarityCollectionName('fake', 'trigram')
		};
	});

	afterAll(async () => {
		// No bulk delete-by-filter needed: every point this suite wrote carries this run's
		// unique universeId, so nothing here is ever queried by a later run again. Qdrant
		// has no per-test collection to drop the way a scratch Postgres database does.
	});

	function embed(text: string): number[] {
		return trigramEmbedding(text, VECTOR_SIZE);
	}

	it('misses when nothing has been recorded yet', async () => {
		const hit = await findSimilarMedia(deps, {
			vector: embed('a portrait of a ranger, ink and wash'),
			universeId,
			feature: 'portrait'
		});
		expect(hit).toBeNull();
	});

	it('hits on a near-identical prompt after one is recorded, at or above the 0.94 threshold (#67 acceptance)', async () => {
		const prompt = 'Aldric Vane, ink and wash, muted, cold light';
		const vector = embed(prompt);
		const pointId = randomUUID();
		const mediaAssetId = randomUUID();

		await recordMediaVector(deps, {
			pointId,
			vector,
			universeId,
			feature: 'portrait',
			mediaAssetIds: [mediaAssetId]
		});

		// The exact same prompt, embedded again (a second identical generate request) -
		// cosine similarity 1.0, comfortably above 0.94.
		const hit = await findSimilarMedia(deps, {
			vector: embed(prompt),
			universeId,
			feature: 'portrait'
		});
		expect(hit).not.toBeNull();
		expect(hit?.pointId).toBe(pointId);
		expect(hit?.mediaAssetIds).toEqual([mediaAssetId]);
		expect(hit?.score).toBeGreaterThanOrEqual(0.94);
	});

	it('does not hit on a genuinely different prompt in the same universe and feature', async () => {
		const pointId = randomUUID();
		await recordMediaVector(deps, {
			pointId,
			vector: embed('Aldric Vane, ink and wash, muted, cold light'),
			universeId,
			feature: 'portrait',
			mediaAssetIds: [randomUUID()]
		});

		const hit = await findSimilarMedia(deps, {
			vector: embed('The Gilded Rat, a smoky tavern at midnight'),
			universeId,
			feature: 'portrait'
		});
		expect(hit).toBeNull();
	});

	it('scopes hits to the same feature - a variants prompt never hits a portrait point', async () => {
		const prompt = 'Aldric Vane, ink and wash, muted, cold light';
		await recordMediaVector(deps, {
			pointId: randomUUID(),
			vector: embed(prompt),
			universeId,
			feature: 'portrait',
			mediaAssetIds: [randomUUID()]
		});

		const hit = await findSimilarMedia(deps, {
			vector: embed(prompt),
			universeId,
			feature: 'variants'
		});
		expect(hit).toBeNull();
	});

	it('scopes hits to the same universe - the same prompt in a different universe never hits', async () => {
		const prompt = 'Aldric Vane, ink and wash, muted, cold light';
		await recordMediaVector(deps, {
			pointId: randomUUID(),
			vector: embed(prompt),
			universeId,
			feature: 'portrait',
			mediaAssetIds: [randomUUID()]
		});

		const hit = await findSimilarMedia(deps, {
			vector: embed(prompt),
			universeId: `${universeId}-other`,
			feature: 'portrait'
		});
		expect(hit).toBeNull();
	});
});
