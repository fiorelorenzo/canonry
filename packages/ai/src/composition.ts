/**
 * The composition root: turning the `(provider, modelId)` pair `model_config` stores into a
 * real AI SDK model.
 *
 * On Vercel AI Gateway this is almost nothing, which is the point. A model is addressed by the
 * slug `provider/model` and the gateway resolves it, so the per-provider factory table this
 * file used to carry for Cloudflare (one `create*` import per vendor, plus the `CF_TEMP_TOKEN`
 * placeholder that had to be stripped before the request left) is gone. Adding a provider is
 * now a row in `model_config`, not a code change.
 *
 * What is deliberately kept is the loud failure. `KNOWN_PROVIDERS` still exists and is still
 * validated, because the admin panel offers it as a select and because an unknown provider
 * should be refused where a human can see it rather than becoming a 404 from the gateway in the
 * middle of a GM's save. The list is what this gateway can actually route, not everything the
 * gateway supports.
 */
import type { EmbeddingModel, LanguageModel } from 'ai';
import { createGateway, type GatewayCredentials } from './gateway.js';

/**
 * Providers this build will construct a model for.
 *
 * `mistral` is present for text only and is deliberately not a candidate for embeddings:
 * `mistral-embed` is English-only per Mistral's own documentation, and SPEC.md §17 requires an
 * Italian question to find an English chunk.
 */
export const KNOWN_PROVIDERS = ['openai', 'anthropic', 'google', 'groq', 'mistral', 'xai'] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

/** Narrows an arbitrary string (a form field, a `model_config` row written before a provider was
 * removed) to a provider this build can actually construct. The widening on the array is what
 * lets a `readonly` tuple's `includes` take a plain string at all; the check itself is real, so
 * an unknown provider is rejected rather than asserted away. */
export function isKnownProvider(value: string): value is KnownProvider {
	const known: readonly string[] = KNOWN_PROVIDERS;
	return known.includes(value);
}

export class UnknownProviderError extends Error {
	constructor(provider: string) {
		super(
			`model_config names provider "${provider}", which this build does not route. ` +
				`Known providers: ${KNOWN_PROVIDERS.join(', ')}. Add it to KNOWN_PROVIDERS in ` +
				`packages/ai/src/composition.ts rather than working around it at the call site, so the ` +
				`admin panel's own select and this check keep agreeing.`
		);
		this.name = 'UnknownProviderError';
	}
}

function slug(provider: string, modelId: string): string {
	if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
		throw new UnknownProviderError(provider);
	}
	// The gateway addresses models as `provider/model`. A modelId that already carries its own
	// provider prefix is passed through rather than doubled: `model_config` rows written against
	// the gateway's own catalogue often hold the full slug, and `openai/openai/gpt-...` is a 404
	// nobody enjoys debugging.
	return modelId.includes('/') ? modelId : `${provider}/${modelId}`;
}

/**
 * Builds the language model a `model_config` row names.
 *
 * This is the function every package's injected `ModelFactory` seam expects:
 * `packages/copilot`'s `models.ts`, `packages/import`'s `DbModelSelector`,
 * `packages/indexing`'s extraction pass and `packages/warm`'s generators all take a factory of
 * this shape, so wiring production is passing this in and nothing else changes.
 *
 * A user's own provider key (issue #90) is **not** a parameter here any more. Vercel takes
 * bring-your-own-key per request through `providerOptions`, not at construction, so it lives in
 * `byokProviderOptions` (gateway.ts) and is merged by whoever makes the call. That is a better
 * fit than the old fourth argument: the same model object can serve a call billed to us and a
 * call billed to the user, and nothing has to rebuild it.
 */
export function createLanguageModel(
	provider: string,
	modelId: string,
	credentials?: GatewayCredentials
): LanguageModel {
	return createGateway(credentials).languageModel(slug(provider, modelId));
}

/**
 * Builds the embedding model a `model_config` row names, for the `embedding` purpose.
 *
 * This had no counterpart at all under the previous gateway, which is why retrieval was still
 * running on a bag-of-words hash while SPEC.md §17 promised that an Italian question finds an
 * English chunk. The gateway routes `google/gemini-embedding-001`, the model that promise was
 * written against, so the claim is now testable rather than inferred from a leaderboard.
 */
export function createEmbeddingModel(
	provider: string,
	modelId: string,
	credentials?: GatewayCredentials
): EmbeddingModel {
	// `embeddingModel`, not the deprecated `textEmbeddingModel` alias.
	return createGateway(credentials).embeddingModel(slug(provider, modelId));
}
