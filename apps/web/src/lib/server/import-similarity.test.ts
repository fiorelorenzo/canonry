/**
 * Issue #279: which `SimilarityFn` a real import actually scores entity matches with.
 *
 * Before this, `importMatchSimilarity` was `lexicalTrigramSimilarity` in every environment,
 * so a production import running the real `GatewayDriver` with real credentials still
 * matched entities by character-trigram Jaccard. `resolveImportSimilarity` is the missing
 * branch, and it is a branch on one thing: whether `AI_GATEWAY_API_KEY` is present.
 *
 * Both directions are asserted here, and neither needs a real credential or a network call.
 * `$env/dynamic/private` is mocked because that is where the check reads from, and the
 * embedding branch only has to be *chosen* to be proven: `createEmbeddingModel` builds a
 * gateway-routed model object without contacting anything, so a fake key is enough to prove
 * the wiring while spending nothing. A test that skipped itself without credentials would
 * assert nothing at all in CI, which is exactly where the regression would land.
 */
import { closeDb, createDb, type Db } from '@canonry/db';
import { clearModelCache } from '@canonry/ai';
import {
	EMBEDDING_MATCH_THRESHOLDS,
	lexicalTrigramSimilarity,
	MATCH_THRESHOLDS
} from '@canonry/import';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveImportSimilarity } from './onboarding.js';

/** `vi.hoisted` rather than a plain `const`: `vi.mock` is lifted above every import in this
 * file, so its factory runs while `./onboarding.js` is being loaded, which is before a
 * normal top-level `const` has initialised. Mutating this object per test is the whole
 * point - the two branches differ only in whether `AI_GATEWAY_API_KEY` is set. */
const { gatewayEnv } = vi.hoisted(() => ({
	gatewayEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: gatewayEnv }));

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

let db: Db;

beforeAll(() => {
	db = createDb(DATABASE_URL);
});

afterAll(async () => {
	await closeDb(db);
});

beforeEach(() => {
	for (const key of Object.keys(gatewayEnv)) delete gatewayEnv[key];
	clearModelCache();
});

const GILDED_RAT = { name: 'the Gilded Rat', aliases: [] };
const RATTO_DORATO = { id: 'inn-gilded-rat', name: 'Il Ratto Dorato', aliases: [] };

describe('resolveImportSimilarity (issue #279)', () => {
	it('falls back to the lexical scorer with no AI_GATEWAY_API_KEY, which is what CI and a dev box get', async () => {
		const { similarity, thresholds, isLexical } = await resolveImportSimilarity(db, {
			userId: 'irrelevant-no-call-is-made',
			universeId: null
		});

		expect(isLexical).toBe(true);
		expect(similarity).toBe(lexicalTrigramSimilarity);
		expect(thresholds).toBe(MATCH_THRESHOLDS);
		// And it really is scoring trigram overlap: SPEC.md §6.4's bilingual pair stays near
		// zero, which is the blind spot the embedding branch exists to close.
		expect(await similarity(GILDED_RAT, RATTO_DORATO)).toBeLessThan(0.1);
	});

	it('picks the embedding-backed scorer once a gateway key is present', async () => {
		gatewayEnv.AI_GATEWAY_API_KEY = 'test-key-not-a-real-credential';

		const { similarity, isLexical } = await resolveImportSimilarity(db, {
			userId: 'irrelevant-no-call-is-made',
			universeId: null
		});

		expect(isLexical).toBe(false);
		expect(similarity).not.toBe(lexicalTrigramSimilarity);
		// The one thing the embedding scorer can answer with no network at all: two
		// byte-identical texts short-circuit to 1 rather than costing a call. Anything that
		// needs a real vector belongs in packages/bench's matching-sweep, not in CI.
		expect(await similarity(GILDED_RAT, { ...RATTO_DORATO, name: 'the Gilded Rat' })).toBe(1);
	});

	it('pairs each scorer with its own band, because a cosine threshold is not a Jaccard one', async () => {
		const lexical = await resolveImportSimilarity(db, {
			userId: 'irrelevant-no-call-is-made',
			universeId: null
		});
		gatewayEnv.AI_GATEWAY_API_KEY = 'test-key-not-a-real-credential';
		const embedding = await resolveImportSimilarity(db, {
			userId: 'irrelevant-no-call-is-made',
			universeId: null
		});

		expect(embedding.thresholds).toBe(EMBEDDING_MATCH_THRESHOLDS);
		expect(embedding.thresholds).not.toEqual(lexical.thresholds);
		// The specific regression this pairing prevents (issue #279's measurement): the lowest
		// cosine the labelled corpus produced was 0.642, so a `newBelow` from the trigram band
		// is unreachable for the embedding scorer and its "new" outcome would never fire.
		expect(embedding.thresholds.newBelow).toBeGreaterThan(lexical.thresholds.newBelow);
	});
});
