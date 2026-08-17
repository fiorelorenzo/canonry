/**
 * `trigramEmbedding` and `FakeEmbeddingProvider` are exercised without any credential (#67's
 * "test against a local fake"), because the 0.94 similarity threshold has to be testable on a
 * machine with no keys.
 *
 * `GatewayEmbeddingProvider` is exercised **against the real gateway**, skipped when no key is
 * present. That replaces the local HTTP double this file used to carry, and it is a deliberate
 * trade: the double proved our request shape against Cloudflare's OpenAI-compatible proxy, but
 * we no longer build that request ourselves. The AI SDK does, over a Vercel-specific wire
 * format, so a double would now assert that we can imitate somebody else's protocol rather than
 * that anything works. What is worth proving is what the double never could: that a real
 * embedding comes back, and that the `model_call` row lands with real token counts at zero
 * credits, which is the margin question in SPEC.md §15.
 */
import { closeDb, eq, inArray, type Db } from '@canonry/db';
import { modelCall, user } from '@canonry/db/schema';
import {
	clearModelCache,
	MissingGatewayEnvError,
	readGatewayCredentials,
	resolveModel
} from '@canonry/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEmbeddingProvider, GatewayEmbeddingProvider, trigramEmbedding } from './embedding.js';
import { openTestDb } from './test-db.js';

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
	return dot; // both vectors are already L2-normalised, so the dot product is cosine.
}

describe('trigramEmbedding (#67, credential-free fake)', () => {
	it('scores near-identical prompts at or above the 0.94 threshold', () => {
		const a = trigramEmbedding('a rainy dockside at night, lantern light on wet stone', 256);
		const b = trigramEmbedding('a rainy dockside at night, lantern light on wet stones', 256);
		expect(cosineSimilarity(a, b)).toBeGreaterThanOrEqual(0.94);
	});

	it('scores a genuinely different prompt well below the threshold', () => {
		const a = trigramEmbedding('a rainy dockside at night, lantern light on wet stone', 256);
		const b = trigramEmbedding('a sunlit meadow at noon, bees over clover', 256);
		expect(cosineSimilarity(a, b)).toBeLessThan(0.94);
	});

	it('is deterministic - the same text always embeds to the same vector', () => {
		expect(trigramEmbedding('the Gilded Rat', 256)).toEqual(
			trigramEmbedding('the Gilded Rat', 256)
		);
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

describe('GatewayEmbeddingProvider without a credential', () => {
	it('refuses rather than embedding against nothing', () => {
		// The whole point of MissingGatewayEnvError: a missing key is a loud failure, never a
		// silent direct call or a zero vector that quietly poisons a similarity check.
		expect(() => readGatewayCredentials({})).toThrow(MissingGatewayEnvError);
	});
});

const liveKey = process.env.AI_GATEWAY_API_KEY;
const TEST_USER_ID = 'canonry-media-test-embedding-user';

describe.skipIf(!liveKey)('GatewayEmbeddingProvider against the real gateway (#67, #125)', () => {
	let db: Db;

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
		// The multilingual model SPEC.md §17's cross-language retrieval promise is written
		// against. migration 0013 already seeds media.similarity_check at 0 credits, so the price
		// resolved here is the real row rather than a fixture.
		// Migration 0022 already seeds this row with its real price; the test reads the real
		// configuration rather than overwriting it with a priceless fixture copy.
		clearModelCache();
	});

	afterAll(async () => {
		await db.delete(modelCall).where(eq(modelCall.userId, TEST_USER_ID));
		await db.delete(user).where(inArray(user.id, [TEST_USER_ID]));
		clearModelCache();
		await closeDb(db);
	});

	it('embeds for real, and records the call at zero credits with real tokens', async () => {
		const provider = new GatewayEmbeddingProvider({
			db,
			credentials: readGatewayCredentials(),
			userId: TEST_USER_ID,
			universeId: null,
			agent: 'indexing',
			operation: 'media.similarity_check'
		});

		const vector = await provider.embed('la locanda del Ratto Dorato, di notte');
		expect(vector.length).toBeGreaterThan(100);
		expect(vector.some((v) => v !== 0)).toBe(true);

		const [call] = await db.select().from(modelCall).where(eq(modelCall.userId, TEST_USER_ID));
		expect(call, 'the embedding call has to be recorded, cheap or not').toBeTruthy();
		// Against whatever `model_config` currently names, not a provider spelled out here: this
		// assertion existed as `toBe('google')` and broke the moment the model changed, which taught
		// nothing except that the test knew the answer by heart.
		const configured = await resolveModel(db, 'embedding');
		expect(call?.provider).toBe(configured.provider);
		expect(call?.modelId).toBe(configured.modelId);
		expect(call?.embeddingTokens ?? 0).toBeGreaterThan(0);
		// The active embedding row prices pricePerEmbeddingMTok in its own currency
		// (issue #132), so this is a real cost derived from real tokens, which is the only
		// version of SPEC.md §15's margin question worth asking. What the *user* pays for a
		// similarity check is separately zero, through operation_price's
		// media.similarity_check row - the two numbers are deliberately not the same one.
		expect(Number(call?.costEur)).toBeGreaterThan(0);
	}, 60_000);

	it('crosses the language boundary, which is the whole reason for this model', async () => {
		const provider = new GatewayEmbeddingProvider({
			db,
			credentials: readGatewayCredentials(),
			userId: TEST_USER_ID,
			universeId: null,
			agent: 'indexing',
			operation: 'media.similarity_check'
		});

		// The same fact in two languages, and one unrelated sentence. A multilingual model must
		// rank the translation pair above the unrelated pair; a bag-of-words vectoriser cannot,
		// which is exactly what issue #125 measured before this switch.
		const italian = await provider.embed(
			'La Casa dei Mercanti compra i debiti dei capitani e non li rivende mai.'
		);
		const englishSame = await provider.embed(
			'The Ashen Ledger buys captains debts and never sells them on.'
		);
		const unrelated = await provider.embed('A cartographer draws maps of the northern ice.');

		const norm = (v: number[]) => {
			const len = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
			return v.map((x) => x / len);
		};
		const translationPair = cosineSimilarity(norm(italian), norm(englishSame));
		const unrelatedPair = cosineSimilarity(norm(italian), norm(unrelated));

		// Relative, not absolute. A cosine floor differs per model - this same corpus scores around
		// 0.81 on gemini and lower on qwen3 - so an absolute bar tests which model is configured
		// rather than whether it crosses languages. The gap is the property worth defending, and a
		// margin is required so a model that scores everything alike cannot pass.
		expect(translationPair).toBeGreaterThan(unrelatedPair + 0.05);
	}, 90_000);
});
