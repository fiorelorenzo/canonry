import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, type Db } from '@canonry/db';
import { modelCall, operationPrice, operationPriceChange } from '@canonry/db/schema';
import { like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GatewayCredentials } from './gateway.js';
import type { ResolvedModel } from './models.js';
import { generateImage, ReplicateRequestError } from './replicate.js';
import { openTestDb } from './test-db.js';

const TEST_OPERATION_PREFIX = 'canonry-ai-test-replicate-';
// withUsage now prices every call from operation_price (issue #113); 3 credits matches
// image.portrait's real seeded price, so the success test's credits assertion below still
// reads as a realistic number rather than an arbitrary fixture.
const SUCCESS_PRICE_CREDITS = 3;
const FAILURE_PRICE_CREDITS = 3;

const IMAGE_MODEL: ResolvedModel = {
	purpose: 'image',
	provider: 'replicate',
	modelId: 'prunaai/p-image',
	params: { eurPerImage: 0.03, creditsPerEur: 100 }
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

	function credentials(): GatewayCredentials {
		return { accountId: 'acct-1', gateway: 'gw-1', apiKey: 'gateway-secret', baseUrl };
	}

	it('posts to the gateway Replicate proxy path with both auth headers, and records usage', async () => {
		const operation = `${TEST_OPERATION_PREFIX}success`;

		const prediction = await generateImage({
			db,
			model: IMAGE_MODEL,
			credentials: credentials(),
			replicateApiToken: 'replicate-secret',
			input: { prompt: 'a lighthouse at dusk' },
			userId: 'test-user-1',
			universeId: null,
			agent: 'warm',
			operation
		});

		expect(prediction.status).toBe('succeeded');
		expect(requests).toHaveLength(1);
		const request = requests[0];
		expect(request?.method).toBe('POST');
		expect(request?.url).toBe(
			`/v1/acct-1/gw-1/replicate/v1/models/${IMAGE_MODEL.modelId}/predictions`
		);
		expect(request?.headers['authorization']).toBe('Bearer replicate-secret');
		expect(request?.headers['cf-aig-authorization']).toBe('Bearer gateway-secret');

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
				credentials: credentials(),
				replicateApiToken: 'replicate-secret',
				input: { prompt: 'a lighthouse at dusk' },
				userId: 'test-user-2',
				universeId: null,
				agent: 'warm',
				operation
			})
		).rejects.toBeInstanceOf(ReplicateRequestError);

		const rows = await db.select().from(modelCall).where(like(modelCall.operation, operation));
		expect(rows).toHaveLength(1);
	});
});
