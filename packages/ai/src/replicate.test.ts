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
	ReplicateRequestError,
	ReplicateThrottledError
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
	'test-user-replicate-4',
	'test-user-replicate-5',
	'test-user-replicate-6',
	'test-user-replicate-7'
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
			},
			{
				operation: `${TEST_OPERATION_PREFIX}throttled-success`,
				label: 'Test replicate throttled then succeeded',
				credits: SUCCESS_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: `${TEST_OPERATION_PREFIX}throttled-exhausted`,
				label: 'Test replicate throttled past the bound',
				credits: FAILURE_PRICE_CREDITS,
				kind: 'generation'
			},
			{
				operation: `${TEST_OPERATION_PREFIX}throttled-retry-after`,
				label: 'Test replicate throttle honours retry_after',
				credits: SUCCESS_PRICE_CREDITS,
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

	// #334: Replicate throttles prediction creation hard under $5 of account credit, and
	// answers a 429 with a `retry_after` it expects to be honoured. These three are the
	// contract: a throttle that clears within the bound still succeeds and is still one
	// model_call row and one charge; a throttle that never clears surfaces
	// ReplicateThrottledError and is still recorded (never silently swallowed) but never
	// charged; and the wait genuinely tracks the number Replicate sent, not a guess.
	it('retries a 429 that carries retry_after and succeeds, charging exactly once (#334)', async () => {
		let submissions = 0;
		respond = (req, res) => {
			res.setHeader('content-type', 'application/json');
			if (req.method === 'POST') {
				submissions += 1;
				if (submissions === 1) {
					res.statusCode = 429;
					res.setHeader('retry-after', '0.02');
					res.end(
						JSON.stringify({
							detail: 'Request was throttled. Your rate limit resets in ~10s.',
							status: 429,
							retry_after: 0.02
						})
					);
					return;
				}
			}
			res.end(
				JSON.stringify({
					id: 'pred-throttled',
					status: 'succeeded',
					output: ['https://example.invalid/img.png']
				})
			);
		};
		const operation = `${TEST_OPERATION_PREFIX}throttled-success`;

		const prediction = await generateImage({
			db,
			model: IMAGE_MODEL,
			replicateApiToken: 'replicate-secret',
			input: { prompt: 'a lighthouse at dusk' },
			userId: 'test-user-replicate-5',
			universeId: null,
			agent: 'warm',
			operation,
			baseUrl
		});

		expect(prediction.status).toBe('succeeded');
		expect(submissions).toBe(2); // one throttled attempt, then one that got through

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1); // one row for the submission, not one per retry
		expect(rows[0]?.credits).toBeCloseTo(SUCCESS_PRICE_CREDITS, 6);
	});

	it('gives up once the throttle bound is reached, surfacing ReplicateThrottledError without charging (#334)', async () => {
		let submissions = 0;
		respond = (req, res) => {
			res.setHeader('content-type', 'application/json');
			if (req.method === 'POST') submissions += 1;
			res.statusCode = 429;
			// Small enough that MAX_THROTTLE_ATTEMPTS, not THROTTLE_BUDGET_MS, is what ends this.
			res.setHeader('retry-after', '0.001');
			res.end(JSON.stringify({ detail: 'still throttled', status: 429, retry_after: 0.001 }));
		};
		const operation = `${TEST_OPERATION_PREFIX}throttled-exhausted`;

		await expect(
			generateImage({
				db,
				model: IMAGE_MODEL,
				replicateApiToken: 'replicate-secret',
				input: { prompt: 'a lighthouse at dusk' },
				userId: 'test-user-replicate-6',
				universeId: null,
				agent: 'warm',
				operation,
				baseUrl
			})
		).rejects.toBeInstanceOf(ReplicateThrottledError);

		expect(submissions).toBe(6); // MAX_THROTTLE_ATTEMPTS in replicate.ts

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		// The throttling is still recorded - one row, so a repeatedly-429'd account shows
		// up in model_call rather than vanishing - but never charged.
		expect(rows).toHaveLength(1);
		expect(rows[0]?.credits).toBeCloseTo(0, 6);
	});

	it('waits the retry_after Replicate actually sent, not a fixed delay, falling back to the JSON body when there is no header (#334)', async () => {
		const submittedAt: number[] = [];
		let submissions = 0;
		respond = (req, res) => {
			res.setHeader('content-type', 'application/json');
			if (req.method === 'POST') {
				submissions += 1;
				submittedAt.push(Date.now());
				if (submissions === 1) {
					res.statusCode = 429;
					// No Retry-After header here on purpose - only the JSON body carries
					// retry_after, exercising generateImage's fallback parse path.
					res.end(JSON.stringify({ detail: 'throttled', status: 429, retry_after: 0.15 }));
					return;
				}
			}
			res.end(
				JSON.stringify({
					id: 'pred-retry-after',
					status: 'succeeded',
					output: ['https://example.invalid/img.png']
				})
			);
		};
		const operation = `${TEST_OPERATION_PREFIX}throttled-retry-after`;

		await generateImage({
			db,
			model: IMAGE_MODEL,
			replicateApiToken: 'replicate-secret',
			input: { prompt: 'a lighthouse at dusk' },
			userId: 'test-user-replicate-7',
			universeId: null,
			agent: 'warm',
			operation,
			baseUrl
		});

		expect(submittedAt).toHaveLength(2);
		const waitedMs = submittedAt[1]! - submittedAt[0]!;
		// 150ms declared in the body. Ignoring retry_after (an immediate retry) lands well
		// under 140ms; a fixed backoff unrelated to the declared value (1s is this file's
		// own POLL_INTERVAL_MS-style scale) lands well over 400ms. Neither reading passes.
		expect(waitedMs).toBeGreaterThanOrEqual(140);
		expect(waitedMs).toBeLessThan(1000);
	});
});
