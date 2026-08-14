/**
 * The `warm_artifact.payload` shape for `kind: 'ambient_pack'` (SPEC.md §4.5, §8.2):
 * whatever `generateAmbientPack` (`packages/media/src/audio/generate.ts`) returned,
 * stored verbatim by `putArtifact`. `warm_artifact.payload` is opaque jsonb everywhere
 * else in this codebase (`table/+layout.server.ts`'s own `briefTextOf` comment: "never
 * interprets it") - this is the one place that does, for the one kind whose shape this
 * route actually needs to read, with a real runtime check rather than an inline cast.
 *
 * Shared between `u/[universe]/ambient/[id]/+server.ts` (the layer-listing API) and
 * `u/[universe]/table/+layout.server.ts` (the declared place's pack summary), so the
 * validator is written once.
 */
import type { AmbientLayerResult } from '@canonry/media';

export interface AmbientPackPayload {
	description: string;
	layers: AmbientLayerResult[];
}

function isAmbientLayerResult(value: unknown): value is AmbientLayerResult {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as AmbientLayerResult;
	return (
		typeof candidate.mediaAssetId === 'string' &&
		typeof candidate.prompt === 'string' &&
		(candidate.loopType === 'continuous' ||
			candidate.loopType === 'oneshot' ||
			candidate.loopType === 'interval') &&
		typeof candidate.volume === 'number' &&
		typeof candidate.mimeType === 'string'
	);
}

export function isAmbientPackPayload(value: unknown): value is AmbientPackPayload {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as AmbientPackPayload;
	return (
		typeof candidate.description === 'string' &&
		Array.isArray(candidate.layers) &&
		candidate.layers.every(isAmbientLayerResult)
	);
}
