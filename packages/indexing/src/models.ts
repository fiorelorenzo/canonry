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
 * **What this table does not answer, and why that is stated rather than hidden:**
 * MIRACL and MTEB Multilingual are aggregate scores over many languages; neither
 * publishes an isolated English<->Italian pair, and en/it is exactly the pair this
 * product ships. Two things follow, and both are open gaps rather than settled
 * questions:
 *
 *  1. No live embedding credential exists on this build (`packages/ai`'s
 *     `createLanguageModel` has no embedding-model counterpart yet either - see this
 *     file's own header comment on the provider-mapping boundary - so even a configured
 *     `model_config` row could not be exercised end to end today). Everything this
 *     package proves about cross-lingual retrieval (`cross-lingual-retrieval.test.ts`)
 *     is proven against `hashingEmbedder`, a literal bag-of-words vectoriser, which is
 *     the honest mechanism check ("does the pipeline route a chunk's language through,
 *     does nothing filter on it"), never a claim about `gemini-embedding-001`'s own
 *     recall.
 *  2. The one number SPEC.md §11.4 actually anchors this product to - MRR 0.775 on a
 *     2044-chunk gold corpus - was measured on English content with English questions.
 *     Re-running `packages/indexing`'s retrieval eval (`retrieval-eval.test.ts`) and
 *     `packages/eval`'s harness against a *bilingual* gold corpus, through a real
 *     `gemini-embedding-001` call, is the live benchmark this choice still needs before
 *     anyone treats "en<->it MRR" as measured rather than inferred from a general
 *     leaderboard. That benchmark is the gap; this comment is not a substitute for it.
 */
export const RECOMMENDED_EMBEDDING_MODEL = {
	purpose: 'embedding',
	provider: 'google',
	modelId: 'gemini-embedding-001'
} as const;
