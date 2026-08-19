/**
 * What `ReplicateImageProvider` actually puts on the wire (#332).
 *
 * The bug this file exists to stop recurring is not "the wrong ratio was chosen", it is "the
 * ratio was never sent": `prunaai/p-image` defaults to 16:9, the provider posted only
 * `prompt` and `num_outputs`, and every portrait came back a landscape with nothing in the
 * code or the database looking wrong. A test that asserts on the provider's arguments cannot
 * see that, so this one reads the request body off a local HTTP double standing in for
 * api.replicate.com, which is also what `packages/ai`'s replicate.test.ts does one layer
 * down.
 *
 * The double serves the prediction and the image file both, so the provider's second call
 * (downloading the bytes) is real too and nothing here reaches the network.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, eq, inArray, type Db } from '@canonry/db';
import {
	modelCall,
	operationPrice,
	operationPriceChange,
	universe,
	user
} from '@canonry/db/schema';
import type { ResolvedModel } from '@canonry/ai';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderLimiter } from './concurrency.js';
import { ImageAspectRatioUnsupportedError } from './aspect-ratio.js';
import { ReplicateImageProvider, tinyPngBytes } from './provider.js';
import { openTestDb } from './test-db.js';

const OPERATION = 'canonry-media-test-provider-request';
const USER_ID = 'test-user-media-provider-request';

const PORTRAIT_MODEL: ResolvedModel = {
	purpose: 'image',
	provider: 'replicate',
	modelId: 'prunaai/p-image',
	// #333's corrected list price for p-image, the same number the row carries.
	params: { pricePerImage: 0.005, currency: 'USD', creditsPerEur: 100 }
};

describe('ReplicateImageProvider request body (#332)', () => {
	let db: Db;
	let server: http.Server;
	let baseUrl: string;
	let universeId: string;
	let bodies: Array<Record<string, unknown>>;

	beforeAll(async () => {
		db = openTestDb();
		await db
			.insert(user)
			.values({
				id: USER_ID,
				name: 'Provider Request Test',
				email: `${USER_ID}@canonry.invalid`,
				emailVerified: true
			})
			.onConflictDoNothing();
		await db
			.insert(operationPrice)
			.values({
				operation: OPERATION,
				label: 'Test provider request',
				credits: 3,
				kind: 'generation'
			})
			.onConflictDoNothing();

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: USER_ID,
				name: 'Provider Request Test Universe',
				slug: `media-provider-request-${randomUUID().slice(0, 8)}`,
				kind: 'homebrew'
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;
	});

	afterAll(async () => {
		await db.delete(modelCall).where(eq(modelCall.operation, OPERATION));
		await db.delete(operationPriceChange).where(eq(operationPriceChange.operation, OPERATION));
		await db.delete(operationPrice).where(eq(operationPrice.operation, OPERATION));
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(inArray(user.id, [USER_ID]));
		await closeDb(db);
	});

	beforeEach(async () => {
		bodies = [];
		server = http.createServer((req, res) => {
			if (req.url === '/image.png') {
				res.setHeader('content-type', 'image/png');
				res.end(Buffer.from(tinyPngBytes()));
				return;
			}
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => {
				bodies.push(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						id: 'pred-aspect-1',
						status: 'succeeded',
						output: `${baseUrl}/image.png`
					})
				);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('sends the configured aspect ratio as Replicate\'s own "aspect_ratio" input', async () => {
		const provider = new ReplicateImageProvider({
			db,
			replicateApiToken: 'replicate-secret',
			limiter: new ProviderLimiter(),
			agent: 'media',
			baseUrl
		});

		const images = await provider.generate({
			prompt: 'Aldric Vane, dismissed watch captain',
			model: PORTRAIT_MODEL,
			count: 1,
			userId: USER_ID,
			universeId,
			operation: OPERATION,
			aspectRatio: '3:2'
		});

		expect(images).toHaveLength(1);
		expect(bodies).toHaveLength(1);
		const input = bodies[0]?.input as Record<string, unknown>;
		expect(input.aspect_ratio).toBe('3:2');
		expect(input.prompt).toBe('Aldric Vane, dismissed watch captain');
		expect(input.num_outputs).toBe(1);
	});

	it('omits the key entirely when no ratio is configured', async () => {
		const provider = new ReplicateImageProvider({
			db,
			replicateApiToken: 'replicate-secret',
			limiter: new ProviderLimiter(),
			agent: 'media',
			baseUrl
		});

		await provider.generate({
			prompt: 'a portrait',
			model: PORTRAIT_MODEL,
			count: 1,
			userId: USER_ID,
			universeId,
			operation: OPERATION
		});

		// Not `aspect_ratio: undefined`, which JSON.stringify would drop anyway, but proof
		// that a row saying nothing still means "the model's own default", the behaviour
		// every row had before migration 0045.
		expect(Object.keys(bodies[0]?.input as Record<string, unknown>)).toEqual([
			'prompt',
			'num_outputs'
		]);
	});

	it('refuses a ratio the model does not accept without submitting or charging', async () => {
		const provider = new ReplicateImageProvider({
			db,
			replicateApiToken: 'replicate-secret',
			limiter: new ProviderLimiter(),
			agent: 'media',
			baseUrl
		});

		await expect(
			provider.generate({
				prompt: 'a portrait',
				model: PORTRAIT_MODEL,
				count: 1,
				userId: USER_ID,
				universeId,
				operation: OPERATION,
				// p-image's enum has no 21:9. Replicate's answer to this would be its own
				// default, silently, which is the whole of #332.
				aspectRatio: '21:9'
			})
		).rejects.toBeInstanceOf(ImageAspectRatioUnsupportedError);

		expect(bodies).toHaveLength(0);
	});
});
