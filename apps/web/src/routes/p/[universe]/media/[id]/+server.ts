/**
 * Serves a published image's bytes to a player (#254). Mirrors the GM route at
 * `w/[universe]/e/[slug]/media/[id]/+server.ts`: same content-type and cache-control
 * handling, reading is free (SPEC.md §15), no session required beyond the universe
 * having a public wiki at all - anyone with the link may load whatever `/p/**` actually
 * shows.
 *
 * The gate is `publicMediaAssetById` and nothing else: published, this universe, the
 * asset's entity not `gm_only`, that entity's revelation confirmed - the same double
 * gate `publicEntityBySlug` applies to prose (guardrail 6). No route-local re-check of
 * any of that here, on purpose: a second opinion about who may see what is exactly what
 * this route must never be.
 */
import { error } from '@sveltejs/kit';
import { publicMediaAssetById } from '@canonry/db';
import { db } from '$lib/server/db';
import { loadPublicUniverse } from '$lib/server/players';
import { mediaStorage } from '$lib/server/media';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const conn = db();
	const universe = await loadPublicUniverse(conn, params.universe);
	if (!universe) error(404, `No universe called "${params.universe}"`);

	const asset = await publicMediaAssetById(conn, universe.id, params.id);
	if (!asset) error(404, 'No such image');

	const bytes = await mediaStorage().read(asset.path);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': asset.mimeType,
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
