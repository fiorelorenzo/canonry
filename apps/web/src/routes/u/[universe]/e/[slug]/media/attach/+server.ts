/**
 * "Insert" in the F1 = C dialog (#66): attaches one already-generated, unattached
 * media_asset to this entry. A separate step from generate on purpose (decision F1's own
 * "rejected outright" section: generation and insertion stay two steps everywhere, so
 * guardrail 6 never has to special-case a freshly generated image).
 */
import { error, json } from '@sveltejs/kit';
import { attachMediaAsset, mediaAssetById } from '@canonry/db';
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
	if (typeof mediaAssetId !== 'string')
		error(400, messages(locals.locale).entry.errors.mediaAssetIdMustBeString);

	const existing = await mediaAssetById(context.conn, mediaAssetId);
	if (!existing || existing.universeId !== context.universe.id) {
		error(404, messages(locals.locale).entry.errors.noSuchGeneratedImage);
	}

	try {
		const attached = await attachMediaAsset(context.conn, mediaAssetId, context.entity.id);
		return json({ id: attached.id, entityId: attached.entityId });
	} catch {
		error(409, messages(locals.locale).entry.errors.alreadyAttached);
	}
};
