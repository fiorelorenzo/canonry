// SPEC.md §11.1. These tests cover the credential contract and the BYOK shape, not the
// gateway's own behaviour: what matters here is that a missing credential fails loudly rather
// than degrading into a direct provider call, and that the bring-your-own-key payload is the
// shape Vercel documents. A real call against the gateway is proven separately, in a test that
// is skipped without a credential, so the suite stays runnable on a machine with no keys.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { closeDb, eq } from '@canonry/db';
import { modelConfig } from '@canonry/db/schema';
import { openTestDb } from './test-db.js';
import { embed, generateText } from 'ai';
import { byokProviderOptions, MissingGatewayEnvError, readGatewayCredentials } from './gateway.js';
import { createEmbeddingModel, createLanguageModel, UnknownProviderError } from './composition.js';

/** Only the one field this test reads: the catalogue is external input, so it is parsed rather
 * than trusted, and a shape change fails here instead of somewhere confusing. */
const ModelListResponse = z.object({ data: z.array(z.object({ id: z.string() })) });

describe('readGatewayCredentials', () => {
	it('reads the one variable the gateway needs', () => {
		expect(readGatewayCredentials({ AI_GATEWAY_API_KEY: 'vck_test' })).toEqual({
			apiKey: 'vck_test'
		});
	});

	it('carries a base URL override when one is set, for tests only', () => {
		expect(
			readGatewayCredentials({
				AI_GATEWAY_API_KEY: 'vck_test',
				AI_GATEWAY_BASE_URL: 'http://127.0.0.1:1/v1'
			})
		).toEqual({ apiKey: 'vck_test', baseUrl: 'http://127.0.0.1:1/v1' });
	});

	it('throws a named error rather than falling back to a direct provider call', () => {
		expect(() => readGatewayCredentials({})).toThrow(MissingGatewayEnvError);
		expect(() => readGatewayCredentials({})).toThrow(/AI_GATEWAY_API_KEY/);
	});

	it('ignores the Cloudflare-era variables instead of half-configuring itself', () => {
		// A deployment mid-migration may still set these. Reading them would be worse than
		// ignoring them: it would suggest they still mean something.
		expect(
			readGatewayCredentials({
				AI_GATEWAY_API_KEY: 'vck_test',
				AI_GATEWAY_ACCOUNT_ID: 'stale',
				AI_GATEWAY_NAME: 'stale'
			})
		).toEqual({ apiKey: 'vck_test' });
	});
});

describe('model construction', () => {
	const credentials = { apiKey: 'vck_test' };

	it('builds a gateway slug from provider and model', () => {
		const model = createLanguageModel('openai', 'gpt-4.1-mini', credentials);
		expect(model).toBeTruthy();
	});

	it('does not double a modelId that already carries its provider', () => {
		// `openai/openai/gpt-...` is a 404 nobody enjoys debugging, and rows written against the
		// gateway's own catalogue often hold the full slug.
		const model = createLanguageModel('openai', 'openai/gpt-4.1-mini', credentials);
		expect(model).toBeTruthy();
	});

	it('refuses a provider this build does not route, where a human can see it', () => {
		expect(() => createLanguageModel('nonesuch', 'whatever', credentials)).toThrow(
			UnknownProviderError
		);
		expect(() => createEmbeddingModel('nonesuch', 'whatever', credentials)).toThrow(
			/Known providers/
		);
	});

	it('builds an embedding model, which had no counterpart before the switch', () => {
		expect(createEmbeddingModel('google', 'gemini-embedding-001', credentials)).toBeTruthy();
	});
});

describe('byokProviderOptions (issue #90)', () => {
	it('is the shape Vercel documents for request-scoped BYOK', () => {
		expect(byokProviderOptions('anthropic', 'sk-ant-user')).toEqual({
			gateway: { byok: { anthropic: [{ apiKey: 'sk-ant-user' }] } }
		});
	});
});

// The only test here that spends money. Skipped unless a real key is present, so the suite runs
// on a machine with no credentials, and deliberately tiny: the point is that the wiring reaches
// a real provider and comes back with usage we can bill, not that the model is any good.
const liveKey = process.env.AI_GATEWAY_API_KEY;
describe.skipIf(!liveKey)('against the real gateway', () => {
	it('generates text and reports usage', async () => {
		const model = createLanguageModel('openai', 'gpt-4.1-mini');
		const result = await generateText({
			model,
			prompt: 'Reply with the single word: ready',
			maxOutputTokens: 16
		});
		expect(result.text.toLowerCase()).toContain('ready');
		expect(result.usage.inputTokens ?? 0).toBeGreaterThan(0);
	}, 60_000);

	it('embeds text with the multilingual model SPEC.md §17 depends on', async () => {
		const model = createEmbeddingModel('google', 'gemini-embedding-001');
		const { embedding } = await embed({ model, value: 'la locanda del Ratto Dorato' });
		expect(embedding.length).toBeGreaterThan(100);
		expect(embedding.some((v) => v !== 0)).toBe(true);
	}, 60_000);
});

/**
 * The test this file was missing, and the reason a whole deployment was broken while every other
 * test passed: `model_config` named `anthropic/claude-3-5-haiku-20241022` and
 * `anthropic/claude-opus-4-1-20250805`, which were Cloudflare pass-through ids. Vercel's gateway
 * routes neither, so every Loremaster call answered "No output generated" - a failure only a real
 * call with the *configured* ids could surface, since every other test constructs its own model.
 *
 * Reads the gateway's own catalogue once and checks the seeded rows against it, so it costs
 * nothing and fails with the id it could not find rather than a stream error three layers up. A
 * migrated test database is the right target rather than production's: the migrations are what
 * ships, and a row an admin edits at runtime is their call, not this suite's.
 */
describe.skipIf(!liveKey)('every configured model is one this gateway actually routes', () => {
	it('finds each active model_config row in the gateway catalogue', async () => {
		const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
			headers: { authorization: `Bearer ${liveKey}` }
		});
		expect(response.ok, 'the gateway has to answer its own model list').toBe(true);
		const catalogue = ModelListResponse.parse(await response.json());
		const routable = new Set(catalogue.data.map((model) => model.id));

		const db = openTestDb();
		try {
			const rows = await db
				.select({
					purpose: modelConfig.purpose,
					provider: modelConfig.provider,
					modelId: modelConfig.modelId
				})
				.from(modelConfig)
				.where(eq(modelConfig.active, true));
			expect(rows.length, 'no active model rows means nothing was checked').toBeGreaterThan(0);

			const missing = rows
				.map((row) => ({ ...row, slug: `${row.provider}/${row.modelId}` }))
				.filter((row) => !routable.has(row.slug))
				.map((row) => `${row.purpose} -> ${row.slug}`);
			expect(missing, 'these configured models do not exist on the gateway').toEqual([]);
		} finally {
			await closeDb(db);
		}
	}, 60_000);
});
