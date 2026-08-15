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
 * The embedding model is the one choice in this product that is expensive to reverse: change it
 * and every vector ever written is unreadable, so every customer's corpus has to be embedded
 * again. That is why the requirement driving it is not accuracy alone but **portability**, and why
 * the chosen model has open weights.
 *
 * **Chosen: `alibaba` / `qwen3-embedding-4b`, 2560 dimensions. Apache-2.0.**
 *
 * ### Measured, on our own corpus, not taken from a leaderboard
 *
 * `packages/eval`'s retrieval harness over the Valdoria Reach gold corpus (20 questions, labels
 * justified by the text of the chunk they name), run twice: once asking in English, once asking
 * the same 20 in Italian against the same mostly-English chunks. That second run is the only
 * measurement that speaks to SPEC.md §17, and no published benchmark answers it for en/it.
 *
 * | model | licence | dims | $/Mtok | EN MRR | IT MRR | separation |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | `alibaba/qwen3-embedding-8b` | Apache-2.0 | 4096 | 0.050 | 0.808 | **0.813** | 0.195 |
 * | `alibaba/qwen3-embedding-4b` | Apache-2.0 | 2560 | 0.020 | 0.793 | **0.795** | 0.188 |
 * | `alibaba/qwen3-embedding-0.6b` | Apache-2.0 | 1024 | 0.010 | 0.783 | 0.750 | 0.158 |
 * | `google/gemini-embedding-001` | closed | 3072 | 0.150 | 0.799 | 0.677 | 0.091 |
 * | `cohere/embed-v4.0` | closed | 1536 | 0.120 | 0.715 | 0.645 | 0.147 |
 * | `openai/text-embedding-3-large` | closed | 3072 | 0.130 | 0.832 | 0.620 | 0.183 |
 * | `google/text-multilingual-embedding-002` | closed | 768 | 0.025 | 0.688 | 0.506 | 0.094 |
 * | `mistral/mistral-embed` | closed | 1024 | 0.100 | 0.777 | 0.454 | 0.048 |
 *
 * The column that decided it is the distance between the two MRRs. Every closed model degrades
 * when the question changes language: OpenAI loses 0.212, gemini 0.122, mistral 0.323. Qwen3 loses
 * nothing (4b: 0.793 -> 0.795), and separates a real answer from noise twice as well as the model
 * it replaces (0.188 against 0.091). A bilingual canon needs symmetry, not an English model with
 * multilingual coverage bolted on.
 *
 * `mistral-embed` is in the table as a control: our own notes called it English-only, and it
 * collapsed exactly as predicted, which is the evidence that the harness measures something.
 *
 * 4b over 8b: the 0.018 MRR difference is one question changing rank on a 20-question corpus, so
 * it is noise, while 2.5x the price and 1.6x the storage are not. 4b over 0.6b: 0.045 MRR is a
 * real if modest gap, and 0.6b stays the choice if CPU self-hosting ever becomes the priority,
 * since it is the only size that runs on a box without a GPU.
 *
 * ### Two findings worth keeping, because both cost real time to learn
 *
 *  1. **The instruction prefix Qwen's model card suggests makes our retrieval worse**, in 5 of 6
 *     configurations measured (0.6b Italian: 0.750 -> 0.653). We do not send one. This is measured
 *     rather than assumed, and it should be re-measured before anyone adds one back.
 *  2. **Absolute cosines are on a different scale than the previous model's**, and a threshold is
 *     not transferable between models. Qwen's relevant scores sit at a median of 0.46 to 0.52
 *     where gemini's noise floor alone was 0.55. Shipping this model while keeping the old
 *     threshold would have thrown away most correct hits, silently. See `retriever.ts`.
 *
 * ### Portability, which is the actual requirement
 *
 * Apache-2.0 weights, served today by Vercel AI Gateway, DeepInfra, Fireworks, Together AI,
 * Cloudflare Workers AI and Alibaba DashScope, so there is more than one exit. Measured here:
 * repeated calls for the same text return vectors with cosine self-similarity of 0.99989 (element
 * deltas around 2e-3), so the same weights at the same precision are interchangeable for
 * retrieval, and moving provider preserves the index. Changing *model* does not: different models
 * rank the same question differently, which is what a re-index buys back.
 *
 * Rejected on licence, recorded so nobody re-proposes them: `jinaai/jina-embeddings-v3` is
 * CC-BY-NC, `jina-embeddings-v4` is research-only, and Google's `embeddinggemma` ships under
 * Google's own Gemma terms rather than Apache-2.0. None can back a commercial product, whatever
 * their benchmark numbers say.
 *
 * ### Still open
 *
 * The corpus is 20 questions over 15 chunks. It is enough to separate Qwen3 from the closed models
 * (a 0.12 to 0.34 MRR gap) and not enough to separate the three Qwen sizes from each other. SPEC.md
 * §11.4's "MRR 0.775 on a 2044-chunk gold corpus" remains a number from research rather than from
 * this repository, and a corpus that size is what would make the sizes distinguishable.
 */
export const RECOMMENDED_EMBEDDING_MODEL = {
	purpose: 'embedding',
	provider: 'alibaba',
	modelId: 'qwen3-embedding-4b'
} as const;

/**
 * Output width per embedding model, because Qdrant needs the number before the first vector
 * exists and a wrong one corrupts a collection silently (see `ensureCollection`'s
 * `onDimensionMismatch`). Deliberately a lookup that throws on an unknown model rather than a
 * configurable default: an env var like `EMBEDDING_VECTOR_SIZE` cannot be kept in step with a
 * model that admins change from the database, and the two disagreeing is exactly the failure
 * this table prevents.
 *
 * Every number is the model's native output size, measured by embedding one string through the
 * gateway rather than read off a model card, because a card that documents Matryoshka truncation
 * often quotes the truncated figure. We request no truncation anywhere in this codebase.
 */
const EMBEDDING_DIMENSIONS: Readonly<Record<string, number>> = {
	'alibaba/qwen3-embedding-0.6b': 1024,
	'alibaba/qwen3-embedding-4b': 2560,
	'alibaba/qwen3-embedding-8b': 4096,
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
