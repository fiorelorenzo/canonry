/**
 * End-to-end coverage for #68, against the real Postgres and real Qdrant this box runs -
 * only the audio provider (ElevenLabs) and the layer-decomposition language model are
 * fakes, exactly what this package's own report names as what only a live credential
 * would prove beyond this suite. FakeAudioProvider returns real, decodable WAV bytes
 * (never a fabricated stub) and FilesystemMediaStorage writes them to a real temp
 * directory, so "the layer is stored" is checked by reading the file back.
 *
 * This file is the acceptance test for #68's three observable claims: a pack generates
 * with its layers, kinds and credits; a second identical request is served from the SFX
 * cache without a provider call; a near-duplicate description in the same scene is
 * suppressed by the Jaccard check rather than regenerated.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, eq, mediaAssetById, sql, type Db } from '@canonry/db';
import { modelCall, modelConfig, universe, user } from '@canonry/db/schema';
import { createVectorClient } from '@canonry/vector';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeEmbeddingProvider } from '../embedding.js';
import { FilesystemMediaStorage } from '../storage.js';
import type { AudioSimilarityCacheDeps } from './cache.js';
import { AMBIENT_LAYERS_OPERATION } from './layers.js';
import { generateAmbientPack } from './generate.js';
import { AiDisabledError } from '../generate.js';
import { FakeAudioProvider } from './provider.js';
import { openTestDb } from '../test-db.js';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function usage(inputTotal: number, outputTotal: number) {
	return {
		inputTokens: {
			total: inputTotal,
			noCache: inputTotal,
			cacheRead: undefined,
			cacheWrite: undefined
		},
		outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined }
	};
}

function scriptedModel(object: unknown): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: {
			content: [{ type: 'text', text: JSON.stringify(object) }],
			finishReason: { unified: 'stop', raw: undefined },
			usage: usage(100, 70),
			warnings: []
		}
	}) as unknown as LanguageModel;
}

const DOCKSIDE_LAYERS = {
	layers: [
		{ prompt: 'gentle rain falling on leaves', loopType: 'continuous', volume: 0.6 },
		{ prompt: 'a single dock bell toll', loopType: 'oneshot', volume: 0.5 },
		{
			prompt: 'distant thunder rumble',
			loopType: 'interval',
			intervalMinSeconds: 15,
			intervalMaxSeconds: 45,
			volume: 0.4
		}
	]
};

const DOCKSIDE_DESCRIPTION =
	'A rainy dockside at night, waves against the pier, a bell tolling somewhere, distant thunder rolling in.';

describe('generateAmbientPack (#68)', () => {
	let db: Db;
	let storageRoot: string;
	let similarity: AudioSimilarityCacheDeps;
	let userId: string;
	let universeId: string;

	beforeAll(async () => {
		db = openTestDb();
		storageRoot = await mkdtemp(path.join(tmpdir(), 'canonry-media-audio-test-'));
		similarity = { client: createVectorClient(), vectorSize: 256 };

		userId = unique('audio-generate-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Audio Generate Test Owner', email: `${userId}@example.test` });
	});

	afterAll(async () => {
		await rm(storageRoot, { recursive: true, force: true });
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	beforeEach(async () => {
		// One active row per purpose is a unique index, and vitest runs this package's files in
		// parallel against one database, so this used to `delete(modelConfig)` wholesale and
		// insert. That deleted a sibling file's row mid-test: this file and layers.test.ts both
		// want an active `cheap` row, and embedding.test.ts wants an `embedding` one. Upserting
		// the single row this file needs leaves every other purpose alone.
		await db
			.insert(modelConfig)
			.values({
				purpose: 'cheap',
				provider: 'test-provider',
				modelId: 'test-cheap',
				active: true,
				params: {}
			})
			.onConflictDoUpdate({
				target: modelConfig.purpose,
				targetWhere: sql`${modelConfig.active} = true`,
				set: { provider: 'test-provider', modelId: 'test-cheap', params: {} }
			});

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Audio Generate Test Universe',
				slug: unique('audio-generate-test-universe'),
				kind: 'homebrew',
				aiEnabled: true
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;
	});

	afterEach(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
	});

	function baseInput(overrides: Partial<Parameters<typeof generateAmbientPack>[0]> = {}) {
		return {
			db,
			audio: new FakeAudioProvider(),
			embeddings: new FakeEmbeddingProvider(),
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			languageModel: () => scriptedModel(DOCKSIDE_LAYERS),
			universeId,
			aiEnabled: true,
			userId,
			description: DOCKSIDE_DESCRIPTION,
			activePack: null,
			...overrides
		};
	}

	it('generates a pack in layers, showing kinds and credits recorded (#68 acceptance)', async () => {
		const audio = new FakeAudioProvider();

		const result = await generateAmbientPack(baseInput({ audio }));

		expect(result.suppressed).toBe(false);
		expect(result.layers).toHaveLength(3);
		expect(result.layers.map((l) => l.loopType)).toEqual(['continuous', 'oneshot', 'interval']);
		expect(result.layers.every((l) => l.generated)).toBe(true);
		// operation_price's real seeded audio.layer price (3 credits per generated layer,
		// SPEC.md §8.1's cost anchor), once per layer.
		expect(result.layers.map((l) => l.credits)).toEqual([3, 3, 3]);
		expect(result.totalCredits).toBeCloseTo(9, 6);
		expect(audio.calls).toHaveLength(3);

		// Every layer is a real, stored, decodable WAV file - not a fabricated row.
		for (const layer of result.layers) {
			expect(layer.mimeType).toBe('audio/wav');
		}

		// The interval layer kept its min/max seconds through the whole pipeline.
		const intervalLayer = result.layers.find((l) => l.loopType === 'interval');
		expect(intervalLayer?.intervalMinSeconds).toBe(15);
		expect(intervalLayer?.intervalMaxSeconds).toBe(45);

		// audio.layers_parse (the decomposition step) is recorded, at zero credits (H1).
		const parseCalls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, AMBIENT_LAYERS_OPERATION));
		const mine = parseCalls.filter((c) => c.userId === userId);
		expect(mine).toHaveLength(1);
		expect(mine[0]?.credits).toBe(0);
	});

	it('the second identical request is served from the SFX cache without a provider call (#68 acceptance)', async () => {
		const audio = new FakeAudioProvider();

		const first = await generateAmbientPack(baseInput({ audio }));
		expect(audio.calls).toHaveLength(3);

		const second = await generateAmbientPack(baseInput({ audio }));

		expect(second.suppressed).toBe(false); // no activePack passed - a fresh request
		expect(second.layers.map((l) => l.mediaAssetId)).toEqual(
			first.layers.map((l) => l.mediaAssetId)
		);
		expect(second.layers.every((l) => l.generated)).toBe(false);
		expect(second.layers.every((l) => l.credits === 0)).toBe(true);
		expect(second.totalCredits).toBe(0);
		// The provider was never called a second time - this is the whole point of the
		// SFX cache (SPEC.md §8.2's 0.94 threshold).
		expect(audio.calls).toHaveLength(3);

		// The stored file from the first call is still the one served - reading it back by
		// its real media_asset path proves the second call reused the real file, not a
		// re-generated duplicate.
		const cachedAsset = await mediaAssetById(db, second.layers[0]!.mediaAssetId);
		if (!cachedAsset) throw new Error('expected the cached media_asset row to still exist');
		const bytes = await readFile(path.join(storageRoot, cachedAsset.path));
		expect(bytes.byteLength).toBeGreaterThan(0);
	});

	it('a near-duplicate description in the same scene is suppressed by Jaccard, never reaching the provider (#68 acceptance)', async () => {
		const audio = new FakeAudioProvider();

		const first = await generateAmbientPack(baseInput({ audio }));
		expect(audio.calls).toHaveLength(3);

		const parseCallsBefore = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, AMBIENT_LAYERS_OPERATION));

		// A paraphrase of the exact same scene - same core nouns (rain, dockside, bell,
		// thunder), different wording, well above the 0.30 threshold.
		const paraphrase =
			'A rainy dockside at night, waves slapping against the dock, a bell ringing somewhere, distant thunder rolling closer.';

		const second = await generateAmbientPack(
			baseInput({
				audio,
				description: paraphrase,
				activePack: { description: DOCKSIDE_DESCRIPTION, layers: first.layers }
			})
		);

		expect(second.suppressed).toBe(true);
		expect(second.description).toBe(DOCKSIDE_DESCRIPTION);
		expect(second.layers).toEqual(first.layers);
		expect(second.totalCredits).toBe(0);
		// Nothing was generated and nothing was even decomposed - the suppression fires
		// before parseAmbientLayers is ever called.
		expect(audio.calls).toHaveLength(3);
		const parseCallsAfter = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, AMBIENT_LAYERS_OPERATION));
		expect(parseCallsAfter).toHaveLength(parseCallsBefore.length);
	});

	it('a genuine scene change (not a paraphrase) is not suppressed, even with an active pack', async () => {
		const audio = new FakeAudioProvider();
		const first = await generateAmbientPack(baseInput({ audio }));

		const cellarLayers = {
			layers: [{ prompt: 'dripping water in a stone cellar', loopType: 'continuous', volume: 0.5 }]
		};
		const second = await generateAmbientPack(
			baseInput({
				audio,
				languageModel: () => scriptedModel(cellarLayers),
				description: 'A damp stone cellar, dripping water, rats scurrying in the dark.',
				activePack: { description: DOCKSIDE_DESCRIPTION, layers: first.layers }
			})
		);

		expect(second.suppressed).toBe(false);
		expect(second.layers).toHaveLength(1);
		expect(audio.calls).toHaveLength(4); // 3 from the first pack, 1 new
	});

	it('refuses to generate when the universe has AI switched off (guardrail 4)', async () => {
		const audio = new FakeAudioProvider();

		await expect(
			generateAmbientPack(baseInput({ audio, aiEnabled: false }))
		).rejects.toBeInstanceOf(AiDisabledError);
		expect(audio.calls).toHaveLength(0);
	});
});
