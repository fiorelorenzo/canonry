/**
 * The `gm_only` toggle in the Images tab (issue #382, decision R7). One boolean, one
 * endpoint - a GM holding a picture back is the same deliberate act as releasing it
 * again, not a separate "undo" surface. Sibling of `attach` and `style` in every
 * respect: same `loadMediaContext`/`requireWriter` resolution, same shape of request
 * validation. This is also the only caller of `setMediaAssetGmOnly` in the app, so
 * `gm_only` only ever changes through a GM's own click here (guardrail 6).
 */
import { error, json } from '@sveltejs/kit';
import { mediaAssetById, setMediaAssetGmOnly } from '@canonry/db';
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
	const gmOnly =
		typeof body === 'object' && body !== null && 'gmOnly' in body ? body.gmOnly : undefined;
	if (typeof mediaAssetId !== 'string')
		error(400, messages(locals.locale).entry.errors.mediaAssetIdMustBeString);
	if (typeof gmOnly !== 'boolean')
		error(400, messages(locals.locale).entry.media.publish.gmOnlyMustBeBoolean);

	// Only this entry's own attached assets - a GM toggling from one entry's Images tab
	// must not be able to flip a stray id belonging to someone else's entry or universe.
	const existing = await mediaAssetById(context.conn, mediaAssetId);
	if (!existing || existing.entityId !== context.entity.id) {
		error(404, messages(locals.locale).entry.errors.noSuchImage);
	}

	const updated = await setMediaAssetGmOnly(context.conn, mediaAssetId, gmOnly);
	return json({ id: updated.id, gmOnly: updated.gmOnly });
};
