/**
 * "Use as cover" in the Images section (O2, #284). Sibling of `publish` in every respect:
 * same `loadMediaContext`/`requireWriter` resolution, same request validation, same
 * this-entry-only ownership check, and the same single-writer discipline. This is the only
 * caller of `setEntityCover` in the app, so `entity.cover_asset_id` only ever changes
 * through a GM's own click here.
 *
 * That is guardrail 1 holding without a second mechanism for images: an image a model
 * generated does not become the entry's face until a person presses something that says so,
 * and there is no accept-all, no default and no side effect of generating, attaching or
 * uploading that reaches this handler. `mediaAssetId: null` clears the cover, which is the
 * same deliberate act in reverse rather than a separate undo surface.
 *
 * It says nothing at all about players. Guardrail 6 has no exception for images, so
 * `published_to_players` stays untouched here and remains the only thing that decides
 * whether the cover appears on `/p/<slug>`: `publicEntityBySlug` resolves the cover against
 * the published rows it already fetched, so a cover a GM set but never published is simply
 * absent there.
 */
import { error, json } from '@sveltejs/kit';
import { mediaAssetById, setEntityCover } from '@canonry/db';
import { messages } from '$lib/i18n';
import type { RequestHandler } from './$types';
import { loadMediaContext, requireWriter } from '../_context.js';

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);
	requireWriter(locals, context.role);

	const body: unknown = await request.json();
	const mediaAssetId =
		typeof body === 'object' && body !== null && 'mediaAssetId' in body
			? body.mediaAssetId
			: undefined;
	if (mediaAssetId !== null && typeof mediaAssetId !== 'string')
		error(400, messages(locals.locale).entry.media.cover.mediaAssetIdMustBeStringOrNull);

	if (mediaAssetId !== null) {
		// Only this entry's own attached assets, the same reasoning `publish` states: a GM
		// setting a cover from one entry's Images section must not be able to name a stray id
		// belonging to someone else's entry or universe.
		const existing = await mediaAssetById(context.conn, mediaAssetId);
		if (!existing || existing.entityId !== context.entity.id) {
			error(404, messages(locals.locale).entry.errors.noSuchImage);
		}
		// An audio asset is a real `media_asset` row on an entity and would satisfy the check
		// above, so the kind is checked here rather than assumed: a cover is drawn in an
		// `<img>`, and an ambient layer has no business there.
		if (existing.kind !== 'image') {
			error(400, messages(locals.locale).entry.media.cover.mustBeAnImage);
		}
	}

	const updated = await setEntityCover(context.conn, {
		entityId: context.entity.id,
		mediaAssetId
	});
	return json({ coverAssetId: updated.coverAssetId });
};
