/**
 * The real `ModelSelector` (issue #24, SPEC.md §6.7): "the model chosen per job from the
 * database... bulk extraction runs on a cheap model, the premium one is reserved for what
 * a playbook marks as hard, and the multimodal one is used only where a page actually has
 * to be looked at."
 *
 * `GatewayDriver`'s `runDocument` (gateway-driver.ts) already decides *which* purpose to
 * ask for at each step - `playbook.modelPurpose` by default, escalated to `'premium'` for
 * a document the playbook's `hardBytesThreshold` marks hard, escalated to `'multimodal'`
 * for the step right after a `page_image` call. This file's only job is turning that
 * purpose into a real, gateway-routable `LanguageModel`: ask the database what model is
 * active for the purpose (`resolvePurpose`, `@canonry/ai`'s `resolveModel(db, purpose)` in
 * production), then turn the resolved provider/model id into an actual `LanguageModel`
 * (`createLanguageModel`, the provider-string -> factory mapping that does not exist
 * anywhere in `@canonry/ai` yet).
 *
 * Both are injected rather than imported directly, for the same reason `GatewayDriver`
 * itself takes `ModelSelector` as an interface: this class stays testable with a canned
 * resolver and no live database or gateway credentials, and the real `resolveModel` +
 * provider factory wiring is supplied once, by whoever constructs a `DbModelSelector`.
 */
import type { LanguageModel } from 'ai';
import type { ImportModel, ModelSelector } from './gateway-driver.js';
import type { ImportModelPurpose } from './playbook.js';

/** What the database read returns for one purpose: provider, model id and the pricing
 * params `@canonry/ai`'s `computeCost` needs. Mirrors `@canonry/ai`'s `ResolvedModel`
 * structurally rather than importing it - this file has no dependency on `@canonry/ai`'s
 * types, only on whatever shape `resolvePurpose` hands back. */
export interface PurposeResolution {
	provider: string;
	modelId: string;
	params: {
		eurPerInputMTok?: number;
		eurPerOutputMTok?: number;
		eurPerEmbeddingMTok?: number;
		eurPerImage?: number;
		creditsPerEur?: number;
	};
}

export type ResolvePurpose = (purpose: ImportModelPurpose) => Promise<PurposeResolution>;
export type LanguageModelFactory = (provider: string, modelId: string) => LanguageModel;

export interface DbModelSelectorDeps {
	resolvePurpose: ResolvePurpose;
	createLanguageModel: LanguageModelFactory;
}

export class DbModelSelector implements ModelSelector {
	constructor(private readonly deps: DbModelSelectorDeps) {}

	async resolve(purpose: ImportModelPurpose): Promise<ImportModel> {
		const resolution = await this.deps.resolvePurpose(purpose);
		const languageModel = this.deps.createLanguageModel(resolution.provider, resolution.modelId);
		return {
			languageModel,
			provider: resolution.provider,
			modelId: resolution.modelId,
			params: resolution.params
		};
	}
}
