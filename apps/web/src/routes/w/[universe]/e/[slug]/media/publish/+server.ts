/**
 * The publish/unpublish control in the Images tab (#254). One boolean, one endpoint - a
 * GM taking a picture back is the same deliberate act as showing it, not a separate
 * "undo" surface. Sibling of `attach` and `style` in every respect: same
 * `loadMediaContext`/`requireWriter` resolution, same shape of request validation. This
 * is also the only caller of `setMediaAssetPublished` in the app, so `published_to_players`
 * only ever changes through a GM's own click here (guardrail 6, issue #71).
 */
import { error, json } from '@sveltejs/kit';
import { mediaAssetById, setMediaAssetPublished } from '@canonry/db';
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
	const published =
		typeof body === 'object' && body !== null && 'published' in body ? body.published : undefined;
	if (typeof mediaAssetId !== 'string')
		error(400, messages(locals.locale).entry.errors.mediaAssetIdMustBeString);
	if (typeof published !== 'boolean')
		error(400, messages(locals.locale).entry.media.publish.publishedMustBeBoolean);

	// Only this entry's own attached assets - a GM publishing from one entry's Images tab
	// must not be able to flip a stray id belonging to someone else's entry or universe.
	const existing = await mediaAssetById(context.conn, mediaAssetId);
	if (!existing || existing.entityId !== context.entity.id) {
		error(404, messages(locals.locale).entry.errors.noSuchImage);
	}

	const updated = await setMediaAssetPublished(context.conn, mediaAssetId, published);
	return json({ id: updated.id, publishedToPlayers: updated.publishedToPlayers });
};
