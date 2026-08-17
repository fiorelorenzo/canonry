/**
 * End-to-end coverage for #64-#67 and #71, against the real Postgres and real Qdrant this
 * box runs - only the provider (Replicate) and the embedding call are fakes, exactly what
 * this package's own report names as the two things a real credential would prove beyond
 * this suite. FakeImageProvider returns real, decodable PNG bytes (never a fabricated
 * stub) and FilesystemMediaStorage writes them to a real temp directory, so "the image is
 * stored" is checked by reading the file back, not by trusting a return value.
 */
import { mediaSimilarityCollectionName } from './similarity.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, eq, type Db } from '@canonry/db';
import {
	entity,
	imageModelConfig,
	imageStyle,
	mediaAsset,
	revelation,
	universe,
	user
} from '@canonry/db/schema';
import { createVectorClient } from '@canonry/vector';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeEmbeddingProvider } from './embedding.js';
import { AiDisabledError, generateImages } from './generate.js';
import { FakeImageProvider } from './provider.js';
import { FilesystemMediaStorage } from './storage.js';
import type { SimilarityCacheDeps } from './similarity.js';
import {
	lockImageModelConfigForFile,
	openTestDb,
	unlockImageModelConfigForFile
} from './test-db.js';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('generateImages (#64-#67, #71)', () => {
	let db: Db;
	let storageRoot: string;
	let similarity: SimilarityCacheDeps;
	let userId: string;
	let universeId: string;

	beforeAll(async () => {
		db = openTestDb();
		// image_model_config is a global singleton this file and models.test.ts both drive,
		// and vitest runs the two concurrently against the same database - see
		// lockImageModelConfigForFile (#193) for why this has to be a lock, not a cleaner
		// delete/insert.
		await lockImageModelConfigForFile(db);
		storageRoot = await mkdtemp(path.join(tmpdir(), 'canonry-media-test-'));
		similarity = {
			client: createVectorClient(),
			vectorSize: 256,
			collection: mediaSimilarityCollectionName('fake', 'trigram')
		};

		userId = unique('media-generate-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Generate Test Owner', email: `${userId}@example.test` });
	});

	afterAll(async () => {
		await rm(storageRoot, { recursive: true, force: true });
		await unlockImageModelConfigForFile(db);
		await closeDb(db);
	});

	beforeEach(async () => {
		// Isolated test database (test-global-setup.ts) migrated fresh, including the seed
		// migration's real portrait/variants rows - clear them so each test controls its own
		// model config without fighting the active-per-feature unique index. Safe from
		// models.test.ts's own image_model_config writes because beforeAll above holds
		// lockImageModelConfigForFile for this file's whole run (#193).
		await db.delete(imageModelConfig);

		const [style] = await db
			.insert(imageStyle)
			.values({ name: 'House style', promptModifier: 'ink and wash, muted, cold light' })
			.returning();
		if (!style) throw new Error('image_style insert did not return a row');

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Generate Test Universe',
				slug: unique('media-generate-test-universe'),
				kind: 'homebrew',
				imageStyleId: style.id,
				aiEnabled: true
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;

		await db.insert(imageModelConfig).values([
			{
				feature: 'portrait',
				provider: 'replicate',
				modelId: 'prunaai/p-image',
				active: true,
				params: { pricePerImage: 0.02, currency: 'EUR' }
			},
			{
				feature: 'variants',
				provider: 'replicate',
				modelId: 'black-forest-labs/flux-schnell',
				active: true,
				params: { pricePerImage: 0.01, currency: 'USD' }
			}
		]);
	});

	afterEach(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
	});

	async function makeEntity(overrides: { imagePromptModifier?: string | null } = {}) {
		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Aldric Vane',
				slug: unique('aldric-vane'),
				body: 'Dismissed watch captain, lean and grey-coated, Lantern Quarter backdrop.',
				imagePromptModifier: overrides.imagePromptModifier ?? null
			})
			.returning();
		if (!row) throw new Error('entity insert did not return a row');
		return row;
	}

	it('generates a portrait, marked as generated, from the entry plus the universe style (#65, #66)', async () => {
		const target = await makeEntity();
		const images = new FakeImageProvider();
		const embeddings = new FakeEmbeddingProvider();

		const result = await generateImages({
			db,
			images,
			embeddings,
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			entity: { id: target.id, name: target.name, description: target.body },
			feature: 'portrait',
			userId
		});

		expect(result.reusedFromCache).toBe(false);
		expect(result.assets).toHaveLength(1);
		expect(result.prompt).toBe(
			'Aldric Vane. Dismissed watch captain, lean and grey-coated, Lantern Quarter backdrop., ink and wash, muted, cold light'
		);

		const asset = result.assets[0];
		if (!asset) throw new Error('expected one generated asset');
		expect(asset.generated).toBe(true);
		expect(asset.entityId).toBeNull(); // unattached until the GM picks "Insert" (#71)
		expect(asset.publishedToPlayers).toBe(false);
		expect(asset.provider).toBe('replicate');
		expect(asset.modelId).toBe('prunaai/p-image');
		expect(asset.credits).toBeCloseTo(3, 6); // the real seeded image.portrait price

		// The file is really on disk, and really the fake's PNG - not a fabricated row
		// pointing nowhere.
		const bytes = await readFile(path.join(storageRoot, asset.path));
		expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

		expect(images.calls).toHaveLength(1);
		expect(images.calls[0]?.count).toBe(1);
	});

	it('generates four variants for the batch feature', async () => {
		const target = await makeEntity();
		const images = new FakeImageProvider();

		const result = await generateImages({
			db,
			images,
			embeddings: new FakeEmbeddingProvider(),
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			entity: { id: target.id, name: target.name, description: target.body },
			feature: 'variants',
			userId
		});

		expect(result.assets).toHaveLength(4);
		expect(result.assets.every((a) => a.credits > 0)).toBe(true);
		expect(result.assets.reduce((sum, a) => sum + a.credits, 0)).toBeCloseTo(4, 6); // image.variants' real price
		expect(images.calls[0]?.count).toBe(4);
	});

	it('the per-entry override wins over the universe style in the built prompt (#65 acceptance)', async () => {
		const target = await makeEntity({ imagePromptModifier: 'photorealistic, dramatic lighting' });

		const result = await generateImages({
			db,
			images: new FakeImageProvider(),
			embeddings: new FakeEmbeddingProvider(),
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			entity: { id: target.id, name: target.name, description: target.body },
			feature: 'portrait',
			userId
		});

		expect(result.prompt).toContain('photorealistic, dramatic lighting');
		expect(result.prompt).not.toContain('ink and wash');
	});

	it('the second identical request is served from the similarity cache without a provider call (#67 acceptance)', async () => {
		const target = await makeEntity();
		const images = new FakeImageProvider();
		const embeddings = new FakeEmbeddingProvider();

		const first = await generateImages({
			db,
			images,
			embeddings,
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			entity: { id: target.id, name: target.name, description: target.body },
			feature: 'portrait',
			userId
		});
		expect(first.reusedFromCache).toBe(false);
		expect(images.calls).toHaveLength(1);

		const second = await generateImages({
			db,
			images,
			embeddings,
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			entity: { id: target.id, name: target.name, description: target.body },
			feature: 'portrait',
			userId
		});

		expect(second.reusedFromCache).toBe(true);
		// The provider was never called a second time - this is the whole point of #67.
		expect(images.calls).toHaveLength(1);
		expect(second.assets.map((a) => a.id)).toEqual(first.assets.map((a) => a.id));
	});

	it("a different entry/prompt is not served from another entry's cache entry", async () => {
		const first = await makeEntity();
		const second = await db
			.insert(entity)
			.values({
				universeId,
				type: 'place',
				name: 'The Gilded Rat',
				slug: unique('the-gilded-rat'),
				body: 'A smoky tavern at midnight.'
			})
			.returning();
		const secondRow = second[0];
		if (!secondRow) throw new Error('entity insert did not return a row');

		const images = new FakeImageProvider();
		const embeddings = new FakeEmbeddingProvider();
		const commonArgs = {
			db,
			images,
			embeddings,
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			userId,
			feature: 'portrait' as const
		};

		await generateImages({
			...commonArgs,
			entity: { id: first.id, name: first.name, description: first.body }
		});
		const result = await generateImages({
			...commonArgs,
			entity: { id: secondRow.id, name: secondRow.name, description: secondRow.body }
		});

		expect(result.reusedFromCache).toBe(false);
		expect(images.calls).toHaveLength(2);
	});

	it('refuses to generate when the universe has AI switched off (guardrail 4)', async () => {
		await db.update(universe).set({ aiEnabled: false }).where(eq(universe.id, universeId));
		const target = await makeEntity();
		const images = new FakeImageProvider();

		await expect(
			generateImages({
				db,
				images,
				embeddings: new FakeEmbeddingProvider(),
				storage: new FilesystemMediaStorage(storageRoot),
				similarity,
				universeId,
				aiEnabled: false,
				entity: { id: target.id, name: target.name, description: target.body },
				feature: 'portrait',
				userId
			})
		).rejects.toBeInstanceOf(AiDisabledError);

		expect(images.calls).toHaveLength(0);
	});

	it('generate, attach, and reveal the entity to players - the image is still not published (#71 acceptance)', async () => {
		const target = await makeEntity();

		const result = await generateImages({
			db,
			images: new FakeImageProvider(),
			embeddings: new FakeEmbeddingProvider(),
			storage: new FilesystemMediaStorage(storageRoot),
			similarity,
			universeId,
			aiEnabled: true,
			entity: { id: target.id, name: target.name, description: target.body },
			feature: 'portrait',
			userId
		});
		const generated = result.assets[0];
		if (!generated) throw new Error('expected one generated asset');
		expect(generated.publishedToPlayers).toBe(false);

		// Attach: the GM picks this image for the entry (the "Insert" step of the F1 = C
		// dialog). Still no code path here touches published_to_players.
		const [attached] = await db
			.update(mediaAsset)
			.set({ entityId: target.id })
			.where(eq(mediaAsset.id, generated.id))
			.returning();
		if (!attached) throw new Error('attach update did not return a row');
		expect(attached.publishedToPlayers).toBe(false);

		// Reveal the entity to players - a revelation row is the only thing that makes an
		// entity show up in the players' wiki (SPEC.md §10), and the players' query
		// (packages/db/src/queries/players.ts) filters media_asset on published_to_players
		// itself, so this is the realistic trigger a real GM action would fire.
		await db.insert(revelation).values({ universeId, kind: 'entity', entityId: target.id });

		const [afterReveal] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, generated.id));
		expect(afterReveal?.publishedToPlayers).toBe(false);
	});
});
