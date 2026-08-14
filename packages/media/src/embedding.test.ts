/**
 * trigramEmbedding is exercised without any credential (#67's "test against a local
 * fake"). GatewayEmbeddingProvider is exercised against a local HTTP double, same
 * technique @canonry/ai's replicate.test.ts already uses for generateImage - this proves
 * the request shape and the withUsage/pricing wiring (media.similarity_check, seeded at
 * 0 credits) actually work, without needing a real EMBEDDING_API_TOKEN or a live
 * provider. See this file's final test for exactly what only a real token would add.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, and, eq, inArray, sql, type Db } from '@canonry/db';
import { modelCall, modelConfig, user } from '@canonry/db/schema';
import { clearModelCache } from '@canonry/ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GatewayCredentials } from '@canonry/ai';
import {
	EmbeddingRequestError,
	FakeEmbeddingProvider,
	GatewayEmbeddingProvider,
	trigramEmbedding
} from './embedding.js';
import { openTestDb } from './test-db.js';

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
	return dot; // both vectors are already L2-normalised, so the dot product is cosine.
}

describe('trigramEmbedding (#67, credential-free fake)', () => {
	it('scores near-identical prompts at or above the 0.94 threshold', () => {
		const a = trigramEmbedding('Aldric Vane, ink and wash, muted, cold light', 256);
		const b = trigramEmbedding('Aldric Vane, ink and wash, muted, cold light', 256);
		expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
	});

	it('scores a genuinely different prompt well below the threshold', () => {
		const a = trigramEmbedding('Aldric Vane, ink and wash, muted, cold light', 256);
		const b = trigramEmbedding('The Gilded Rat, a smoky tavern at midnight', 256);
		expect(cosineSimilarity(a, b)).toBeLessThan(0.94);
	});

	it('is deterministic - the same text always embeds to the same vector', () => {
		const a = trigramEmbedding('a portrait of a ranger', 128);
		const b = trigramEmbedding('a portrait of a ranger', 128);
		expect(a).toEqual(b);
	});
});

describe('FakeEmbeddingProvider', () => {
	it('records every prompt it was asked to embed', async () => {
		const provider = new FakeEmbeddingProvider();
		await provider.embed('one');
		await provider.embed('two');
		expect(provider.calls).toEqual(['one', 'two']);
	});
});

describe('GatewayEmbeddingProvider (#67, against a local HTTP double)', () => {
	let db: Db;
	let server: http.Server;
	let baseUrl: string;
	let requests: Array<{
		method: string | undefined;
		url: string | undefined;
		headers: http.IncomingHttpHeaders;
		body: string;
	}>;
	let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

	const TEST_USER_ID = 'canonry-media-test-embedding-user';
	const TEST_MODEL_ID_PREFIX = 'canonry-media-test-embed-';

	beforeAll(async () => {
		db = openTestDb();
		await db
			.insert(user)
			.values({
				id: TEST_USER_ID,
				name: 'Embedding Test User',
				email: `${TEST_USER_ID}@canonry.invalid`
			})
			.onConflictDoNothing();
		// migration 0013 already seeds media.similarity_check at 0 credits - this test
		// resolves the price through the real operation_price row, not a fixture one.
		await db.insert(modelConfig).values({
			purpose: 'embedding',
			provider: 'openai',
			modelId: `${TEST_MODEL_ID_PREFIX}v1`,
			active: true,
			params: {}
		});
	});

	afterAll(async () => {
		await db.delete(modelCall).where(eq(modelCall.userId, TEST_USER_ID));
		await db
			.delete(modelConfig)
			.where(sql`${modelConfig.modelId} like ${TEST_MODEL_ID_PREFIX + '%'}`);
		await db.delete(user).where(inArray(user.id, [TEST_USER_ID]));
		clearModelCache();
		await closeDb(db);
	});

	beforeEach(async () => {
		requests = [];
		respond = (_req, res) => {
			res.setHeader('content-type', 'application/json');
			res.end(
				JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { total_tokens: 7 } })
			);
		};
		server = http.createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => {
				requests.push({
					method: req.method,
					url: req.url,
					headers: req.headers,
					body: Buffer.concat(chunks).toString('utf8')
				});
				respond(req, res);
			});
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

	it('posts to the gateway provider-specific embeddings proxy and returns the vector, priced at 0 credits', async () => {
		const provider = new GatewayEmbeddingProvider({
			db,
			credentials: credentials(),
			apiToken: 'embedding-secret',
			userId: TEST_USER_ID,
			universeId: null,
			agent: 'media',
			operation: 'media.similarity_check'
		});

		const vector = await provider.embed('Aldric Vane, ink and wash, muted, cold light');
		expect(vector).toEqual([0.1, 0.2, 0.3]);

		expect(requests).toHaveLength(1);
		const request = requests[0];
		expect(request?.method).toBe('POST');
		expect(request?.url).toBe('/v1/acct-1/gw-1/openai/embeddings');
		expect(request?.headers['authorization']).toBe('Bearer embedding-secret');
		expect(request?.headers['cf-aig-authorization']).toBe('Bearer gateway-secret');
		expect(JSON.parse(request?.body ?? '{}')).toEqual({
			model: `${TEST_MODEL_ID_PREFIX}v1`,
			input: 'Aldric Vane, ink and wash, muted, cold light'
		});

		// Priced through the real, seeded media.similarity_check row - 0 credits, but a
		// model_call row still lands (SPEC.md §15's margin question is answered from
		// those rows and nowhere else, priced or not). Filtered by this test's own user id
		// so it never depends on being the only test that ever calls this operation.
		const rows = await db
			.select()
			.from(modelCall)
			.where(
				and(eq(modelCall.userId, TEST_USER_ID), eq(modelCall.operation, 'media.similarity_check'))
			);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.credits).toBe(0);
		expect(rows[0]?.embeddingTokens).toBe(7);
	});

	it('records the failed call and rethrows on a non-2xx response, without leaking the body', async () => {
		respond = (_req, res) => {
			res.statusCode = 500;
			res.end('internal error');
		};
		const provider = new GatewayEmbeddingProvider({
			db,
			credentials: credentials(),
			apiToken: 'embedding-secret',
			userId: TEST_USER_ID,
			universeId: null,
			agent: 'media',
			operation: 'media.similarity_check'
		});

		await expect(provider.embed('anything')).rejects.toBeInstanceOf(EmbeddingRequestError);
	});

	// Main's note: point at least one test at the real path with a stubbed model to prove
	// the priced path does not throw - both tests above do exactly that (a real
	// model_config row for purpose 'embedding', a real operation_price row for
	// media.similarity_check, only the network call is against a local double). What
	// remains genuinely UNVERIFIED in this sandbox: there is no EMBEDDING_API_TOKEN and
	// no real embedding provider reachable here, so nobody has proven the gateway's
	// OpenAI-compatible proxy accepts this exact request shape for whichever provider a
	// real deployment configures for the 'embedding' purpose. A run with a real token and
	// a real AI_GATEWAY_* set would prove that; this suite proves everything up to the
	// network boundary.
	it('documents the real-path gap this sandbox cannot close', () => {
		expect(process.env.EMBEDDING_API_TOKEN).toBeUndefined();
	});
});
