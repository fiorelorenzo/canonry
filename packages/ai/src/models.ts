/**
 * DB-driven model resolution (SPEC 11.1, 11.5, issue #97). The active model
 * for a purpose lives in `model_config`, not in code, so an admin can switch
 * models without a deploy - that is the whole point of the table.
 */
import type { Db } from '@canonry/db';
import { and, eq } from 'drizzle-orm';
import { modelConfig, type ModelPurpose } from '@canonry/db/schema';

export type { ModelPurpose };

/**
 * Pricing for one model, read from `model_config.params` (jsonb, opaque to
 * @canonry/db). All fields optional - a missing rate means that dimension is
 * free for this model (e.g. an embedding model has no output tokens).
 */
export interface ModelParams {
	eurPerInputMTok?: number;
	eurPerOutputMTok?: number;
	eurPerEmbeddingMTok?: number;
	eurPerImage?: number;
	/** Credits per euro for this model's included-quota accounting (SPEC 15). Defaults to 100 (1 credit = EUR 0.01) when absent. */
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
	if (typeof record.eurPerInputMTok === 'number') params.eurPerInputMTok = record.eurPerInputMTok;
	if (typeof record.eurPerOutputMTok === 'number')
		params.eurPerOutputMTok = record.eurPerOutputMTok;
	if (typeof record.eurPerEmbeddingMTok === 'number')
		params.eurPerEmbeddingMTok = record.eurPerEmbeddingMTok;
	if (typeof record.eurPerImage === 'number') params.eurPerImage = record.eurPerImage;
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
