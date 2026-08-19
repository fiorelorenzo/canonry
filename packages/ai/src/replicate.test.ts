import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, type Db } from '@canonry/db';
import { modelCall, operationPrice, operationPriceChange, user } from '@canonry/db/schema';
import { inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedModel } from './models.js';
import {
	generateImage,
	ReplicatePredictionFailedError,
	ReplicateRequestError
} from './replicate.js';
import { openTestDb } from './test-db.js';

const TEST_OPERATION_PREFIX = 'canonry-ai-test-replicate-';
// withQuota now prices every call from operation_price (issue #113) and charges the
// user's balance on success (issue #88); 3 credits matches image.portrait's real
// seeded price, so the success test's credits assertion below still reads as a
// realistic number rather than an arbitrary fixture.
const SUCCESS_PRICE_CREDITS = 3;
const FAILURE_PRICE_CREDITS = 3;
const TEST_USER_IDS = [
	'test-user-replicate-1',
	'test-user-replicate-2',
	'test-user-replicate-3',
	'test-user-replicate-4'
];

const IMAGE_MODEL: ResolvedModel = {
	purpose: 'image',
	provider: 'replicate',
	modelId: 'prunaai/p-image',
	params: { pricePerImage: 0.03, currency: 'EUR', creditsPerEur: 100 }
};

describe('generateImage', () => {
	let db: Db;
	let server: http.Server;
	let baseUrl: string;
	let requests: Array<{
		method: string | undefined;
		url: string | undefined;
		headers: http.IncomingHttpHeaders;
	}>;
	let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

	beforeAll(async () => {
		db = openTestDb();
		await db
			.insert(user)
			.values(
				TEST_USER_IDS.map((id) => ({
					id,
					name: 'Test User',
					email: `${id}@canonry.invalid`,
					emailVerified: true
				}))
			)
			.onConflictDoNothing();
		await db.insert(operationPrice).values([
			{
				operation: `${TEST_OPERATION_PREFIX}success`,
				label: 'Test replicate success',
				credits: SUCCESS_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: `${TEST_OPERATION_PREFIX}failure`,
				label: 'Test replicate failure',
				credits: FAILURE_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: `${TEST_OPERATION_PREFIX}queued`,
				label: 'Test replicate queued then succeeded',
				credits: SUCCESS_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: `${TEST_OPERATION_PREFIX}refused`,
				label: 'Test replicate prediction failed',
				credits: FAILURE_PRICE_CREDITS,
				kind: 'generation'
			}
		]);
	});

	afterAll(async () => {
		await db.delete(modelCall).where(like(modelCall.operation, `${TEST_OPERATION_PREFIX}%`));
		await db
			.delete(operationPriceChange)
			.where(like(operationPriceChange.operation, `${TEST_OPERATION_PREFIX}%`));
		await db
			.delete(operationPrice)
			.where(like(operationPrice.operation, `${TEST_OPERATION_PREFIX}%`));
		await db.delete(user).where(inArray(user.id, TEST_USER_IDS));
		await closeDb(db);
	});

	beforeEach(async () => {
		requests = [];
		respond = (_req, res) => {
			res.setHeader('content-type', 'application/json');
			res.end(
				JSON.stringify({
					id: 'pred-1',
					status: 'succeeded',
					output: ['https://example.invalid/img.png']
				})
			);
		};
		server = http.createServer((req, res) => {
			requests.push({ method: req.method, url: req.url, headers: req.headers });
			respond(req, res);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('posts directly to api.replicate.com with the Replicate auth header, and records usage', async () => {
		const operation = `${TEST_OPERATION_PREFIX}success`;

		const prediction = await generateImage({
			db,
			model: IMAGE_MODEL,
			replicateApiToken: 'replicate-secret',
			input: { prompt: 'a lighthouse at dusk' },
			userId: 'test-user-replicate-1',
			universeId: null,
			agent: 'warm',
			operation,
			baseUrl
		});

		expect(prediction.status).toBe('succeeded');
		expect(requests).toHaveLength(1);
		const request = requests[0];
		expect(request?.method).toBe('POST');
		expect(request?.url).toBe(`/models/${IMAGE_MODEL.modelId}/predictions`);
		expect(request?.headers['authorization']).toBe('Bearer replicate-secret');
		expect(request?.headers['cf-aig-authorization']).toBeUndefined();

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row?.costEur).toBeCloseTo(0.03, 6);
		expect(row?.credits).toBeCloseTo(3, 6);
		expect(row?.inputTokens).toBe(0);
	});

	it('records a row and rethrows on a non-2xx response, without leaking the body', async () => {
		respond = (_req, res) => {
			res.statusCode = 422;
			res.end(JSON.stringify({ detail: 'a lighthouse at dusk contains disallowed content' }));
		};
		const operation = `${TEST_OPERATION_PREFIX}failure`;

		await expect(
			generateImage({
				db,
				model: IMAGE_MODEL,
				replicateApiToken: 'replicate-secret',
				input: { prompt: 'a lighthouse at dusk' },
				userId: 'test-user-replicate-2',
				universeId: null,
				agent: 'warm',
				operation,
				baseUrl
			})
		).rejects.toBeInstanceOf(ReplicateRequestError);

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
	});

	// #258: Replicate answered `202` with `status: "processing"` and `output: null` after
	// holding `Prefer: wait` for its full sixty seconds, and the old code returned that as a
	// success, so `withQuota` charged for an image the caller then could not find. The poll is
	// inside the quota callback for exactly that reason, and these two tests are the contract:
	// a queued prediction is followed to its end and charged once, and one that ends badly is
	// not charged at all.
	it('polls a queued prediction to its terminal state and charges once (#258)', async () => {
		let submissions = 0;
		respond = (req, res) => {
			res.setHeader('content-type', 'application/json');
			if (req.method === 'POST') {
				submissions += 1;
				res.statusCode = 202;
				res.end(JSON.stringify({ id: 'pred-queued', status: 'processing', output: null }));
				return;
			}
			res.end(
				JSON.stringify({
					id: 'pred-queued',
					status: 'succeeded',
					output: ['https://example.invalid/img.png']
				})
			);
		};
		const operation = `${TEST_OPERATION_PREFIX}queued`;

		const prediction = await generateImage({
			db,
			model: IMAGE_MODEL,
			replicateApiToken: 'replicate-secret',
			input: { prompt: 'a lighthouse at dusk' },
			userId: 'test-user-replicate-3',
			universeId: null,
			agent: 'warm',
			operation,
			baseUrl
		});

		expect(prediction.status).toBe('succeeded');
		expect(submissions).toBe(1); // polled, never re-submitted, so never charged twice
		expect(requests.at(-1)?.url).toBe('/predictions/pred-queued');

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.credits).toBeCloseTo(SUCCESS_PRICE_CREDITS, 6);
	});

	it('does not charge for a prediction that ends as failed (#258)', async () => {
		respond = (req, res) => {
			res.setHeader('content-type', 'application/json');
			res.statusCode = req.method === 'POST' ? 201 : 200;
			res.end(
				JSON.stringify({
					id: 'pred-refused',
					status: req.method === 'POST' ? 'starting' : 'failed',
					output: null,
					error: 'NSFW content detected'
				})
			);
		};
		const operation = `${TEST_OPERATION_PREFIX}refused`;

		await expect(
			generateImage({
				db,
				model: IMAGE_MODEL,
				replicateApiToken: 'replicate-secret',
				input: { prompt: 'a lighthouse at dusk' },
				userId: 'test-user-replicate-4',
				universeId: null,
				agent: 'warm',
				operation,
				baseUrl
			})
		).rejects.toBeInstanceOf(ReplicatePredictionFailedError);

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.credits).toBeCloseTo(0, 6);
		expect(rows[0]?.costEur).toBeCloseTo(0, 6);
	});
});
