/**
 * The composition root every other package deferred: turning the `(provider, modelId)` pair
 * that `model_config` stores into a real AI SDK language model, wrapped by the gateway.
 *
 * Four packages independently built an injected seam for this and left it unfilled, which
 * was the right call each time (none of them should own provider mapping) and left the
 * product unable to make a single real model call. This is the one place that mapping lives.
 *
 * Providers come from `ai-gateway-provider`'s own per-provider factories rather than from
 * `@ai-sdk/*` directly: the library re-exports them and resolves the underlying SDK itself,
 * so adding a provider here is a case in the switch rather than another dependency in the
 * tree. The gateway then wraps whatever model comes out, which is what keeps SPEC section
 * 11.1's promise that every call, text and image alike, goes through one place for logs,
 * caching and cost.
 *
 * `CF_TEMP_TOKEN` is the library's own convention for Cloudflare's Unified Billing: the
 * underlying provider is constructed with that literal, the library strips the header before
 * forwarding, and the gateway bills the account. It is not a placeholder to be replaced with
 * a real per-provider key later, it is how the gateway is meant to be used when the gateway
 * is paying (SPEC section 6.7's metered arrangement).
 */
import { createAnthropic } from 'ai-gateway-provider/providers/anthropic';
import { createGoogleGenerativeAI } from 'ai-gateway-provider/providers/google';
import { createGroq } from 'ai-gateway-provider/providers/groq';
import { createMistral } from 'ai-gateway-provider/providers/mistral';
import { createOpenAI } from 'ai-gateway-provider/providers/openai';
import { createGateway, type GatewayCredentials } from './gateway.js';

/** The literal the gateway expects where a per-provider key would otherwise go. */
const UNIFIED_BILLING_TOKEN = 'CF_TEMP_TOKEN';

export class UnknownProviderError extends Error {
	constructor(provider: string, known: readonly string[]) {
		super(
			`model_config names provider "${provider}", which this build cannot construct. ` +
				`Known providers: ${known.join(', ')}. Add it to packages/ai/src/composition.ts ` +
				`rather than working around it at the call site, since the whole point of that file ` +
				`is that provider mapping lives in exactly one place.`
		);
		this.name = 'UnknownProviderError';
	}
}

/** Whatever the gateway accepts and returns, derived from the gateway itself rather than
 * restated: the AI SDK's own `LanguageModel` union includes a bare string, which the gateway
 * does not accept, and hardcoding a version-suffixed interface here would go stale on the
 * next SDK bump. */
type GatewayFn = ReturnType<typeof createGateway>;
type GatewayModel = Exclude<Parameters<GatewayFn>[0], readonly unknown[]>;
type ProviderFactory = (modelId: string, providerApiKey: string) => GatewayModel;

/**
 * Every provider this build can construct. Deliberately a small, explicit table: a typo in
 * `model_config.provider` should fail loudly with the list of what is possible, not fall back
 * to a default and quietly bill somebody for the wrong model.
 *
 * Each factory takes the api key to hand the underlying SDK rather than closing over
 * `UNIFIED_BILLING_TOKEN` itself - `createLanguageModel`'s `providerApiKey` parameter
 * (issue #90, bring-your-own-key) is what lets a call go out on a user's own provider key
 * instead of the gateway's Unified Billing, through the exact same provider table and the
 * same gateway wrapping, rather than a second code path that could drift from this one.
 */
function providerFactories(): Record<string, ProviderFactory> {
	return {
		openai: (modelId, apiKey) => createOpenAI({ apiKey })(modelId),
		anthropic: (modelId, apiKey) => createAnthropic({ apiKey })(modelId),
		google: (modelId, apiKey) => createGoogleGenerativeAI({ apiKey })(modelId),
		groq: (modelId, apiKey) => createGroq({ apiKey })(modelId),
		mistral: (modelId, apiKey) => createMistral({ apiKey })(modelId)
	};
}

/** Every provider name `createLanguageModel` can construct, derived from the same table
 * rather than duplicated - issue #90's BYO key settings page uses this so it never offers
 * a provider a key could never actually route through. */
export const KNOWN_PROVIDERS: readonly string[] = Object.keys(providerFactories());

/**
 * Builds the model named by a `model_config` row, wrapped by the gateway.
 *
 * This is the function every package's `ModelFactory` seam was waiting for:
 * `packages/copilot`'s `models.ts`, `packages/import`'s `DbModelSelector`,
 * `packages/indexing`'s extraction pass and `packages/warm`'s generators all take an
 * injected factory of exactly this shape, so production wiring is passing this in and
 * nothing else changes.
 *
 * `providerApiKey` is issue #90's bring-your-own-key seam: omitted, every call bills the
 * gateway's own Unified Billing account (`UNIFIED_BILLING_TOKEN`) exactly as before: every
 * existing caller's behaviour is untouched. Set it (to a key `@canonry/ai`'s byo-key.ts has
 * already decrypted) and the same provider, the same model, the same gateway wrapping goes
 * out authenticated as the user's own account instead - SPEC.md §15 / decision F3's "does
 * not change model routing... does not skip the gateway" promise held at the one place that
 * could otherwise have quietly broken it.
 */
export function createLanguageModel(
	provider: string,
	modelId: string,
	credentials?: GatewayCredentials,
	providerApiKey?: string
): ReturnType<GatewayFn> {
	const factories = providerFactories();
	const factory = factories[provider];
	if (!factory) throw new UnknownProviderError(provider, Object.keys(factories));
	const gateway = createGateway(credentials);
	return gateway(factory(modelId, providerApiKey ?? UNIFIED_BILLING_TOKEN));
}
