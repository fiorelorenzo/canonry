/**
 * Model seam for the indexing pipeline's two LLM-backed steps (SPEC.md §7/§11.3): a
 * metadata extraction pass per chunk, and batch embedding. Both take an already
 * gateway-wrapped AI SDK model object, never a provider string - the mapping from
 * `model_config`'s provider/modelId to an actual `ai-gateway-provider` factory belongs to
 * the composition root that wires a real indexing run together, the same boundary
 * packages/import's `GatewayDriver` draws for its own `ModelSelector` (its provider
 * mapping "does not exist anywhere in @canonry/ai yet either", per that file's own
 * comment) - packages/indexing does not reinvent that seam differently.
 */
import type { EmbeddingModel, LanguageModel } from 'ai';
import type { ResolvedModel } from '@canonry/ai';

export type ResolvedExtractionModel = ResolvedModel & { model: LanguageModel };
export type ResolvedEmbeddingModel = ResolvedModel & { model: EmbeddingModel };

/**
 * The deliberate multilingual choice for `model_config`'s `'embedding'` purpose (SPEC.md
 * §17, issue #125): "an Italian question against an English canon must find the English
 * chunk, which makes the embedding model a multilingual choice rather than a free one."
 *
 * Candidates considered, restricted to providers this build can already construct
 * (`KNOWN_PROVIDERS` in `packages/ai/src/composition.ts`: openai, anthropic, google,
 * groq, mistral - anthropic and groq offer no embedding endpoint at all):
 *
 * | Candidate | Provider | Published multilingual evidence | Verdict |
 * | --- | --- | --- | --- |
 * | `mistral-embed` | mistral | English-only per Mistral's own documentation - no multilingual claim exists to check | disqualified outright, not merely "not chosen" |
 * | `text-embedding-3-small` | openai | MIRACL (cross-lingual retrieval benchmark) average 44.0%, up from 31.4% on `ada-002` | multilingual, but the weaker of OpenAI's two |
 * | `text-embedding-3-large` | openai | MIRACL average 54.9% | strong, well-documented second choice |
 * | `gemini-embedding-001` | google | #1 on the MTEB Multilingual leaderboard (task-mean 68.32, Borda rank 1 as of 2025-07); Google states coverage "over 100 languages" | chosen |
 *
 * **Chosen: `google` / `gemini-embedding-001`.** It is the only candidate that is both
 * genuinely multilingual (not retrofitted) and independently verified as the current
 * state of the art on a multilingual retrieval leaderboard, not just improved over its
 * own predecessor the way OpenAI's MIRACL number is framed. `text-embedding-3-large` is
 * the credible fallback if a `google` credential is unavailable in production - it has
 * its own real MIRACL number, unlike `mistral-embed`, which has none because the
 * capability does not exist.
 *
 * **What the leaderboards do not answer, and what has now been measured instead.**
 * MIRACL and MTEB Multilingual are aggregates over many languages; neither publishes an
 * isolated English<->Italian pair, and en/it is exactly the pair this product ships. That gap
 * was open until a live gateway credential existed. It is now partly closed by measurement
 * rather than inference, through the real model over the real gateway:
 *
 * | What was measured | Result |
 * | --- | --- |
 * | The same fact in Italian and English (`La Casa dei Mercanti...` / `The Ashen Ledger...`) | cosine 0.8093 |
 * | An Italian question against the English fact that answers it | cosine 0.7972 |
 * | An Italian fact against unrelated English prose | cosine 0.5571 |
 * | 8 questions (4 Italian) against the 5-chunk fixture world, English prose | the right chunk ranked first 8/8, MRR 1.000 |
 *
 * So §17's promise - "an Italian question against an English canon must find the English
 * chunk" - is now demonstrated rather than assumed, and the margin between signal and noise is
 * about 0.25 of cosine. Two things that measurement also exposed, both acted on:
 *
 *  1. this model's cosine floor is high (unrelated prose sits near 0.55, not near 0), so the
 *     0.5 threshold §11.4 quotes was very nearly a no-op. See `retriever.ts`, where the
 *     threshold is now a noise floor with the numbers behind it written down.
 *  2. it is a 5-chunk smoke calibration on the fixture world, **not** the 2044-chunk gold
 *     corpus §11.4 anchors MRR 0.775 to. That number was measured with `hashingEmbedder` and
 *     is stale for this model in both directions; re-running `packages/eval`'s retrieval
 *     harness against a bilingual gold corpus through this model is still the real benchmark,
 *     and this comment is not a substitute for it.
 */
export const RECOMMENDED_EMBEDDING_MODEL = {
	purpose: 'embedding',
	provider: 'google',
	modelId: 'gemini-embedding-001'
} as const;

/**
 * Output width per embedding model, because Qdrant needs the number before the first vector
 * exists and a wrong one corrupts a collection silently (see `ensureCollection`'s
 * `onDimensionMismatch`). Deliberately a lookup that throws on an unknown model rather than a
 * configurable default: an env var like `EMBEDDING_VECTOR_SIZE` cannot be kept in step with a
 * model that admins change from the database, and the two disagreeing is exactly the failure
 * this table prevents. Every number here is the provider's documented default output size,
 * with no `outputDimensionality` truncation requested anywhere in this codebase.
 */
const EMBEDDING_DIMENSIONS: Readonly<Record<string, number>> = {
	'google/gemini-embedding-001': 3072,
	'google/text-multilingual-embedding-002': 768,
	'openai/text-embedding-3-large': 3072,
	'openai/text-embedding-3-small': 1536
};

export class UnknownEmbeddingDimensionsError extends Error {
	constructor(provider: string, modelId: string) {
		super(
			`no known output dimensionality for embedding model ${provider}/${modelId}. ` +
				`Add it to EMBEDDING_DIMENSIONS in packages/indexing/src/models.ts: a collection created ` +
				`at the wrong width accepts no vectors from this model.`
		);
		this.name = 'UnknownEmbeddingDimensionsError';
	}
}

/** The vector width `model_config`'s current 'embedding' row implies. Throws rather than
 * guessing, so an unrecognised model fails at wiring time instead of at first upsert. */
export function embeddingDimensionsFor(provider: string, modelId: string): number {
	const dimensions = EMBEDDING_DIMENSIONS[`${provider}/${modelId}`];
	if (dimensions === undefined) throw new UnknownEmbeddingDimensionsError(provider, modelId);
	return dimensions;
}
