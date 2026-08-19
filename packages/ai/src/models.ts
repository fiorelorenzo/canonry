/**
 * DB-driven model resolution (SPEC 11.1, 11.5, issue #97). The active model
 * for a purpose lives in `model_config`, not in code, so an admin can switch
 * models without a deploy - that is the whole point of the table.
 */
import type { Db } from '@canonry/db';
import { and, eq } from 'drizzle-orm';
import { modelConfig, type ModelPurpose } from '@canonry/db/schema';
import { isCurrency, type Currency } from './currency.js';

export type { ModelPurpose };

/**
 * Pricing for one model, read from `model_config.params` (jsonb, opaque to
 * @canonry/db). All price fields optional - a missing rate means that dimension is
 * free for this model (e.g. an embedding model has no output tokens).
 */
export interface ModelParams {
	/** The currency every price field below is stated in - the provider's own price
	 * list, never pre-converted (issue #132). Defaults to EUR when absent, which is
	 * honest rather than assumed: every model_config/image_model_config row seeded
	 * before #132 already ran its provider's price through the same dated rate
	 * `toEur` uses now, so an absent currency here is the value those rows were
	 * always in, not a guess. Never mix currencies within one model's params - one
	 * provider, one price list, one currency. */
	currency?: Currency;
	pricePerInputMTok?: number;
	pricePerOutputMTok?: number;
	pricePerEmbeddingMTok?: number;
	pricePerImage?: number;
	/** Price per one of the provider's own metered credits (issue #116) - ElevenLabs'
	 * `character-cost` response header, not a token or image count, so it gets its own
	 * rate rather than being folded into one of the fields above. Zero is a real,
	 * measured price on a plan whose credits are already paid for in a flat monthly cap
	 * (see @canonry/media's AUDIO_MODEL_PARAMS for the account this was measured
	 * against), not a missing value computeCost happens to skip. */
	pricePerProviderCredit?: number;
	/** Credits per euro for this model's included-quota accounting (SPEC 15). Defaults to 100 (1 credit = EUR 0.01) when absent. Always EUR - this is Canonry's own credit rate, not a provider price. */
	creditsPerEur?: number;
}

export interface ResolvedModel {
	purpose: ModelPurpose;
	provider: string;
	modelId: string;
	params: ModelParams;
}

export class ModelNotConfiguredError extends Error {
	constructor(purpose: ModelPurpose) {
		super(`no active model_config row for purpose "${purpose}"`);
		this.name = 'ModelNotConfiguredError';
	}
}

/**
 * 30s TTL, keyed per purpose. SPEC 11.1 wants model routing switchable from an
 * admin surface without a deploy, so a per-call query would be correct but is
 * wasteful on hot paths (every Loremaster turn, every propagation step hits
 * this); a long cache makes the switch feel broken, since an admin who flips
 * `model_config.active` expects it live within moments. 30s, reused from
 * ai-game (SPEC 11.1), is short enough to read as instant and long enough
 * that routine calls do not each cost a round trip to Postgres.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
	value: ResolvedModel;
	expiresAt: number;
}

const cache = new Map<ModelPurpose, CacheEntry>();

export function clearModelCache(): void {
	cache.clear();
}

function readModelParams(value: unknown): ModelParams {
	if (typeof value !== 'object' || value === null) return {};
	const record = value as Record<string, unknown>;
	const params: ModelParams = {};
	if (typeof record.currency === 'string' && isCurrency(record.currency))
		params.currency = record.currency;
	if (typeof record.pricePerInputMTok === 'number')
		params.pricePerInputMTok = record.pricePerInputMTok;
	if (typeof record.pricePerOutputMTok === 'number')
		params.pricePerOutputMTok = record.pricePerOutputMTok;
	if (typeof record.pricePerEmbeddingMTok === 'number')
		params.pricePerEmbeddingMTok = record.pricePerEmbeddingMTok;
	if (typeof record.pricePerImage === 'number') params.pricePerImage = record.pricePerImage;
	if (typeof record.pricePerProviderCredit === 'number')
		params.pricePerProviderCredit = record.pricePerProviderCredit;
	if (typeof record.creditsPerEur === 'number') params.creditsPerEur = record.creditsPerEur;
	return params;
}

export async function resolveModel(db: Db, purpose: ModelPurpose): Promise<ResolvedModel> {
	const now = Date.now();
	const cached = cache.get(purpose);
	if (cached && cached.expiresAt > now) return cached.value;

	const rows = await db
		.select({
			provider: modelConfig.provider,
			modelId: modelConfig.modelId,
			params: modelConfig.params
		})
		.from(modelConfig)
		.where(and(eq(modelConfig.purpose, purpose), eq(modelConfig.active, true)))
		.limit(1);

	const row = rows[0];
	if (!row) throw new ModelNotConfiguredError(purpose);

	const resolved: ResolvedModel = {
		purpose,
		provider: row.provider,
		modelId: row.modelId,
		params: readModelParams(row.params)
	};
	cache.set(purpose, { value: resolved, expiresAt: now + CACHE_TTL_MS });
	return resolved;
}
