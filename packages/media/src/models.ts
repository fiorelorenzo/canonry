/**
 * DB-driven image model resolution (#64, SPEC.md §9: "the active model lives in the
 * database and is the one always used, switchable from an admin surface without a
 * deploy"). The image-specific sibling of @canonry/ai's resolveModel/model_config: that
 * one resolves per *purpose* (cheap/premium/multimodal/embedding/image) and knows nothing
 * about `image_model_config`'s per-*feature* routing (portrait vs the four-variant
 * batch), which is what this module reads instead.
 */
import { activeImageModelRow, type Db, type ImageModelRow } from '@canonry/db';
import type { ImageFeature } from '@canonry/db/schema';
import type { ResolvedModel } from '@canonry/ai';

export type { ImageModelRow };

export interface ImageModelParams {
	/** Our own cost per image in EUR, kept in image_model_config.params - what we pay the
	 * provider. Never the user-facing credit price; operation_price owns that (issue
	 * #113), and the two are deliberately different numbers. */
	eurPerImage?: number;
	creditsPerEur?: number;
}

function readImageModelParams(value: unknown): ImageModelParams {
	if (typeof value !== 'object' || value === null) return {};
	const record = value as Record<string, unknown>;
	const params: ImageModelParams = {};
	if (typeof record.eurPerImage === 'number') params.eurPerImage = record.eurPerImage;
	if (typeof record.creditsPerEur === 'number') params.creditsPerEur = record.creditsPerEur;
	return params;
}

export class ImageModelNotConfiguredError extends Error {
	constructor(feature: ImageFeature) {
		super(`no active image_model_config row for feature "${feature}"`);
		this.name = 'ImageModelNotConfiguredError';
	}
}

/**
 * 30s TTL, mirroring @canonry/ai's resolveModel cache and for the same reason: this sits
 * on the hot "open the generate dialog" path, but an /admin/models save has to be visible
 * on the very next request either way - clearImageModelCache() is what that save calls,
 * the TTL only bounds staleness for an edit nobody explicitly cleared the cache for.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
	value: ImageModelRow;
	expiresAt: number;
}

const cache = new Map<ImageFeature, CacheEntry>();

export function clearImageModelCache(): void {
	cache.clear();
}

export async function resolveImageModelRow(db: Db, feature: ImageFeature): Promise<ImageModelRow> {
	const now = Date.now();
	const cached = cache.get(feature);
	if (cached && cached.expiresAt > now) return cached.value;

	const row = await activeImageModelRow(db, feature);
	if (!row) throw new ImageModelNotConfiguredError(feature);
	cache.set(feature, { value: row, expiresAt: now + CACHE_TTL_MS });
	return row;
}

/** Adapts an image_model_config row into @canonry/ai's ResolvedModel shape so
 * generateImage()/withUsage() can be called unchanged. `purpose` is always 'image' here -
 * accurate (model_config's own 'image' purpose names the same bucket) even though this
 * function's feature-level routing is one level more specific than model_config knows
 * about. */
export async function resolveImageModel(db: Db, feature: ImageFeature): Promise<ResolvedModel> {
	const row = await resolveImageModelRow(db, feature);
	return {
		purpose: 'image',
		provider: row.provider,
		modelId: row.modelId,
		params: readImageModelParams(row.params)
	};
}
