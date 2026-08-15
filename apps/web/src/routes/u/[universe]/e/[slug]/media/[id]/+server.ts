/**
 * Serves one stored file's bytes for an `<img src>` (media_asset.path is a storage-root-
 * relative path, never a public URL - see packages/db/src/schema/media.ts's own comment).
 * Reading is free (SPEC.md §15) - no requireWriter here, a viewer may look.
 */
import { error } from '@sveltejs/kit';
import { mediaAssetById } from '@canonry/db';
import { messages } from '$lib/i18n';
import { mediaStorage } from '$lib/server/media';
import type { RequestHandler } from './$types';
import { loadMediaContext } from '../_context.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);

	const asset = await mediaAssetById(context.conn, params.id);
	if (!asset || asset.universeId !== context.universe.id) {
		error(404, messages(locals.locale).entry.errors.noSuchImage);
	}

	const bytes = await mediaStorage().read(asset.path);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': asset.mimeType,
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
