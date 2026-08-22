/**
 * `GET` serves one stored file's bytes for an `<img src>` (media_asset.path is a
 * storage-root-relative path, never a public URL - see packages/db/src/schema/media.ts's
 * own comment). Reading is free (SPEC.md §15) - no requireWriter here, a viewer may look.
 *
 * `DELETE` (issue #385, decision R10): the delete the three old media surfaces never had
 * a place to put, because none of them owned "every action on the image it applies to".
 * Same `loadMediaContext`/`requireWriter` gate as every other write in this route tree.
 * Removes the row and the stored file through `mediaStorage()`, refused with a reason the
 * gallery can show while the image is still the entry's cover or is still referenced in
 * its body - a body pointing at a missing image is worse than a cover somebody has to
 * remove first, per the issue's own framing.
 *
 * The cover check is what actually keeps `entity.cover_asset_id` from ever pointing at a
 * deleted row: the fk is `onDelete: 'set null'` (packages/db/src/schema/entity.ts), which
 * would quietly heal a dangling reference if this route ever let one through, but a cover
 * silently vanishing out from under a GM is not a good outcome either - refusing the
 * delete outright, before the fk is ever asked to do anything, is what
 * `media/delete.test.ts` proves rather than trusts.
 */
import { error, json } from '@sveltejs/kit';
import { deleteMediaAsset, mediaAssetById } from '@canonry/db';
import { messages } from '$lib/i18n';
import { imageUrlsIn } from '$lib/markdown';
import { mediaStorage } from '$lib/server/media';
import type { RequestHandler } from './$types';
import { loadMediaContext, requireWriter } from '../_context.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);

	const asset = await mediaAssetById(context.conn, params.id);
	if (!asset || asset.universeId !== context.universe.id) {
		error(404, messages(locals.locale).entry.errors.noSuchImage);
	}

	// A row whose bytes are gone answers 404, not 500. The two are not the same claim: a
	// 500 says the server broke, and an `<img>` pointing at one logs a console error on
	// every render of the page that carries it, which is what a restored database whose
	// media directory did not come with it looks like from the browser. The row being
	// present and the file being absent is a real state (a restore, a half-finished
	// migration between storage roots, a file removed underneath us), and the honest
	// answer for it is the same as for an id that never existed: this image is not here.
	// `EntryCoverPlaceholder` and the gallery's own broken-image handling then do what
	// they already do for a missing cover, instead of showing a broken bitmap.
	let bytes: Uint8Array;
	try {
		bytes = await mediaStorage().read(asset.path);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') {
			error(404, messages(locals.locale).entry.errors.noSuchImage);
		}
		throw cause;
	}
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': asset.mimeType,
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);
	requireWriter(locals, context.role);
	const t = messages(locals.locale);

	// Only this entry's own attached assets - the same ownership discipline `cover`,
	// `publish` and `attach` already enforce: a GM deleting from one entry's gallery
	// must not be able to name a stray id belonging to someone else's entry or universe,
	// and an unattached candidate (guardrail 1: not yet accepted) is not this route's
	// business either - discarding one is a client-side no-op, nothing was ever attached.
	const asset = await mediaAssetById(context.conn, params.id);
	if (!asset || asset.entityId !== context.entity.id) {
		error(404, t.entry.errors.noSuchImage);
	}

	if (context.entity.coverAssetId === asset.id) {
		error(409, t.entry.media.delete.refusedCover);
	}

	if (imageUrlsIn(context.entity.body).some((url) => url.split('/').pop() === asset.id)) {
		error(409, t.entry.media.delete.refusedInBody);
	}

	await mediaStorage().delete(asset.path);
	await deleteMediaAsset(context.conn, asset.id);
	return json({ id: asset.id });
};
