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
