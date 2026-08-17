/**
 * How the bench puts a candidate in front of the real code.
 *
 * The temptation with a model benchmark is to write fresh prompts for it, and the result
 * measures the prompts. Everything here runs the product's own functions instead:
 * `planPropagation`, `runAudit`, `generatePlanDiffs`, `completeEntry`, `runAsk`,
 * `GatewayDriver`. They read the model from `model_config` through
 * `@canonry/ai`'s `resolveModel`, so switching candidate means writing that row and
 * clearing the 30 second cache, which is also exactly what an admin does at
 * `/admin/models`. The number the bench produces is therefore a number about this
 * codebase, not about a prompt somebody wrote for the occasion.
 *
 * The one deliberate bypass is `benchModelFactory`. `createLanguageModel` refuses a
 * provider outside `KNOWN_PROVIDERS`, and four candidates sit outside it precisely because
 * nobody has evaluated them yet. The factory addresses the gateway by slug directly, so
 * being unevaluated does not stop a model from being evaluated. Nothing in the product
 * does this.
 */
import { and, eq, type Db } from '@canonry/db';
import { modelConfig } from '@canonry/db/schema';
import type { ModelPurpose } from '@canonry/db/schema';
import {
	clearModelCache,
	createGateway,
	readGatewayCredentials,
	type ResolvedModel
} from '@canonry/ai';
import type { LanguageModel } from 'ai';
import { loadEnv } from '../env.js';
import { pricesFor, type Catalogue } from './catalogue.js';
import { splitSlug } from './candidates.js';

export const identityGateway = (model: LanguageModel): LanguageModel => model;

/** Structural shape of `@canonry/ai`'s `createGateway()` return value, typed locally for
 * the same reason `packages/copilot/src/models.ts` types `GatewayWrapper` locally:
 * `@canonry/ai` does not re-export `@ai-sdk/gateway`'s types, and this package has no
 * reason to depend on that provider just to name a shape. */
interface GatewayModels {
	languageModel(slug: string): LanguageModel;
}

let cachedGateway: GatewayModels | null = null;

/** Resolves `provider/modelId` straight to a gateway language model, without
 * `KNOWN_PROVIDERS` in the way. See this file's header for why that bypass is here and
 * why nothing in the product may copy it. */
export function benchModelFactory(resolved: ResolvedModel): LanguageModel {
	if (!cachedGateway) {
		loadEnv();
		cachedGateway = createGateway(readGatewayCredentials(process.env));
	}
	return cachedGateway.languageModel(`${resolved.provider}/${resolved.modelId}`);
}

/**
 * Points a purpose at one candidate and prices it from the gateway's own list, so the
 * `model_call.cost_eur` rows a run leaves behind are real euros and the bench's cost
 * column and the product's billing column cannot drift apart. Writes the gateway's own
 * USD figures verbatim with `currency: 'USD'` (issue #132) rather than a pre-converted
 * EUR number - `computeCost` converts at read time, the same as every other price in the
 * product, so this and a migration's seed can never drift on which rate they used.
 *
 * Deactivates every other row for the purpose first: `model_config_active_purpose_key` is
 * a unique index on `(purpose)` filtered to `active`, so two active rows is not a state
 * the database will hold.
 */
export async function setActiveModel(
	db: Db,
	purpose: ModelPurpose,
	slug: string,
	catalogue: Catalogue
): Promise<void> {
	const { provider, modelId } = splitSlug(slug);
	const prices = pricesFor(catalogue, slug);
	await db
		.update(modelConfig)
		.set({ active: false })
		.where(and(eq(modelConfig.purpose, purpose), eq(modelConfig.active, true)));
	const existing = await db
		.select({ id: modelConfig.id })
		.from(modelConfig)
		.where(
			and(
				eq(modelConfig.purpose, purpose),
				eq(modelConfig.provider, provider),
				eq(modelConfig.modelId, modelId)
			)
		)
		.limit(1);
	const params = {
		currency: 'USD' as const,
		pricePerInputMTok: prices.usdPerInputMTok,
		pricePerOutputMTok: prices.usdPerOutputMTok
	};
	const row = existing[0];
	if (row) {
		await db
			.update(modelConfig)
			.set({ active: true, params, updatedAt: new Date() })
			.where(eq(modelConfig.id, row.id));
	} else {
		await db.insert(modelConfig).values({ purpose, provider, modelId, active: true, params });
	}
	clearModelCache();
}
