/**
 * Against the real Qdrant instance this box runs (127.0.0.1:56333 via @canonry/vector's
 * own default) - no mock, no fake vector store. Mirrors ../similarity.test.ts's own
 * structure exactly, with `loop` standing in for `feature` as the scoping dimension a
 * hit must also match, since a looping and a non-looping render of the same prompt are
 * not interchangeable (SPEC.md §8.2).
 */
import { randomUUID } from 'node:crypto';
import { createVectorClient } from '@canonry/vector';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trigramEmbedding } from '../embedding.js';
import {
	findSimilarAudioLayer,
	recordAudioLayerVector,
	type AudioSimilarityCacheDeps
} from './cache.js';

const VECTOR_SIZE = 256;

describe('audio SFX cache (#68, against real Qdrant)', () => {
	let deps: AudioSimilarityCacheDeps;
	// Unique per test run, same reasoning as ../similarity.test.ts: no shared collection
	// to drop between runs, every point this suite writes is scoped to this universeId.
	const universeId = `audio-cache-test-${randomUUID()}`;

	beforeAll(() => {
		deps = { client: createVectorClient(), vectorSize: VECTOR_SIZE };
	});

	afterAll(() => {
		// No cleanup needed - see ../similarity.test.ts's own note on this.
	});

	function embed(text: string): number[] {
		return trigramEmbedding(text, VECTOR_SIZE);
	}

	it('misses when nothing has been recorded yet', async () => {
		const hit = await findSimilarAudioLayer(deps, {
			vector: embed('gentle rain falling on leaves'),
			universeId,
			loop: true
		});
		expect(hit).toBeNull();
	});

	it('hits on a near-identical prompt after one is recorded, at or above the 0.94 threshold (#68 acceptance)', async () => {
		const prompt = 'gentle rain falling on leaves';
		const vector = embed(prompt);
		const pointId = randomUUID();
		const mediaAssetId = randomUUID();

		await recordAudioLayerVector(deps, {
			pointId,
			vector,
			universeId,
			loop: true,
			mediaAssetId
		});

		// The exact same prompt, embedded again (a second identical layer request) -
		// cosine similarity 1.0, comfortably above 0.94.
		const hit = await findSimilarAudioLayer(deps, {
			vector: embed(prompt),
			universeId,
			loop: true
		});
		expect(hit).not.toBeNull();
		expect(hit?.pointId).toBe(pointId);
		expect(hit?.mediaAssetId).toBe(mediaAssetId);
		expect(hit?.score).toBeGreaterThanOrEqual(0.94);
	});

	it('does not hit on a genuinely different prompt in the same universe', async () => {
		await recordAudioLayerVector(deps, {
			pointId: randomUUID(),
			vector: embed('gentle rain falling on leaves'),
			universeId,
			loop: true,
			mediaAssetId: randomUUID()
		});

		const hit = await findSimilarAudioLayer(deps, {
			vector: embed('a blacksmith hammering iron on an anvil'),
			universeId,
			loop: true
		});
		expect(hit).toBeNull();
	});

	it('scopes hits to the same loop flag - a looping request never hits a oneshot point', async () => {
		const prompt = 'a single bell toll echoing once';
		await recordAudioLayerVector(deps, {
			pointId: randomUUID(),
			vector: embed(prompt),
			universeId,
			loop: false,
			mediaAssetId: randomUUID()
		});

		const hit = await findSimilarAudioLayer(deps, {
			vector: embed(prompt),
			universeId,
			loop: true
		});
		expect(hit).toBeNull();
	});

	it('scopes hits to the same universe - the same prompt in a different universe never hits', async () => {
		const prompt = 'gentle rain falling on leaves';
		await recordAudioLayerVector(deps, {
			pointId: randomUUID(),
			vector: embed(prompt),
			universeId,
			loop: true,
			mediaAssetId: randomUUID()
		});

		const hit = await findSimilarAudioLayer(deps, {
			vector: embed(prompt),
			universeId: `${universeId}-other`,
			loop: true
		});
		expect(hit).toBeNull();
	});
});
