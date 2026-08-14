/**
 * The model-routing seam (issue #52, SPEC.md §5.1: "a cheap model finds and ranks
 * candidates, a premium model writes the diffs... Resolve both through resolveModel and
 * account for both through withUsage").
 *
 * This package calls `resolveModel(db, purpose)` from `@canonry/ai` directly for both
 * purposes - unlike `packages/import`'s `GatewayDriver`, this package already depends on
 * `@canonry/db` (proposals.ts needs it for the guardrail-1 transaction), so there is no
 * reason to push that read out to an injected composition root the way
 * `packages/import/src/gateway-driver.ts` does.
 *
 * What *is* still injected, mirroring that same file: the raw, provider-specific AI SDK
 * `LanguageModel` for a resolved `provider`/`modelId` pair, and the Cloudflare AI Gateway
 * wrapper. Neither mapping exists in `@canonry/ai` yet - see gateway-driver.ts's header
 * comment ("the composition root that wires a real import job together... is not one of
 * this run's six issues" - the same gap applies here, for the same reason). A real caller
 * supplies both once that composition root exists; ranking.test.ts and diffs.test.ts
 * supply a scripted `MockLanguageModelV4` and the identity wrapper.
 */
import type { LanguageModel } from 'ai';
import type { ModelParams, ModelPurpose, ResolvedModel } from '@canonry/ai';

export type { ModelParams, ModelPurpose, ResolvedModel };

/** Maps a `resolveModel` result onto a real, callable AI SDK model - the mapping
 * `packages/import/src/gateway-driver.ts` describes as not existing anywhere yet. */
export type ModelFactory = (resolved: ResolvedModel) => LanguageModel;

/**
 * Structural shape of `@canonry/ai`'s `createGateway()` return value (`AiGateway` from
 * `ai-gateway-provider`). Typed locally rather than imported, exactly as
 * `packages/import/src/gateway-driver.ts`'s `GatewayWrapper` is: `@canonry/ai` does not
 * re-export `ai-gateway-provider`'s types on its public surface, and this package does not
 * need `ai-gateway-provider` as a dependency of its own just to describe the shape.
 */
export type GatewayWrapper = (model: LanguageModel) => LanguageModel;

/** Resolves a purpose to a callable model, gateway-wrapped, ready to hand to
 * `generateObject`. `withUsage` (from `@canonry/ai`) still needs the plain `ResolvedModel`
 * alongside this for cost accounting - see ranking.ts and diffs.ts for how the two are
 * used together. */
export interface RoutedModel {
	languageModel: LanguageModel;
	resolved: ResolvedModel;
}

export function routeModel(
	resolved: ResolvedModel,
	factory: ModelFactory,
	gateway: GatewayWrapper
): RoutedModel {
	return { languageModel: gateway(factory(resolved)), resolved };
}
