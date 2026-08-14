/**
 * Issue #69's "minimum server route needed to list a pack's layers": one pack (a
 * `warm_artifact` row of kind `ambient_pack`, SPEC.md §4.5/§8.2) by id, returned as the
 * layer list `AmbientPlayer.svelte` needs to build its Web Audio graph. This never
 * serves audio bytes itself - each layer's `url` points at the existing
 * `u/[universe]/e/[slug]/media/[id]` route (`packages/media/src/audio/generate.ts`
 * already stores every layer as a real `media_asset` row), so there is exactly one
 * media-serving endpoint in this app, not two.
 *
 * Reading is free (SPEC.md §15, H1 in docs/ux/DECISIONS.md) - `requireAmbientAccess`
 * checks membership, never role, matching the media byte route's own "no requireWriter
 * here, a viewer may look".
 */
import { error, json } from '@sveltejs/kit';
import { eq, type Db } from '@canonry/db';
import { entity, warmArtifact } from '@canonry/db/schema';
import { isAmbientPackPayload } from '$lib/server/ambient-pack';
import { db } from '$lib/server/db';
import { requireAmbientAccess } from '../_server/guard.js';
import type { RequestHandler } from './$types';

interface LayerView {
	/** The layer's `media_asset.id`. Named `id` rather than `mediaAssetId` because this is
		the wire shape `AmbientPlayer`'s `LayerSpec` reads: it keys the player's keyed
		`{#each}` and its per-layer device preferences. Sending `mediaAssetId` instead left
		every key `undefined`, which threw `each_key_duplicate` and stopped the entire
		player from rendering. */
	id: string;
	url: string;
	prompt: string;
	loopType: 'continuous' | 'oneshot' | 'interval';
	intervalMinSeconds: number | null;
	intervalMaxSeconds: number | null;
	volume: number;
	mimeType: string;
}

async function placeSlugFor(conn: Db, subjectEntityId: string | null): Promise<string> {
	if (!subjectEntityId) {
		error(500, 'This ambient pack has no subject place, so no media URL can be built for it');
	}
	const [row] = await conn
		.select({ slug: entity.slug })
		.from(entity)
		.where(eq(entity.id, subjectEntityId))
		.limit(1);
	if (!row) error(500, 'This ambient pack points at a place that no longer exists');
	return row.slug;
}

export const GET: RequestHandler = async (event) => {
	const access = await requireAmbientAccess(event);
	const conn = db();

	const [artifact] = await conn
		.select()
		.from(warmArtifact)
		.where(eq(warmArtifact.id, event.params.id))
		.limit(1);

	if (!artifact || artifact.universeId !== access.universe.id || artifact.kind !== 'ambient_pack') {
		error(404, 'No such ambient pack in this universe');
	}
	const payload = artifact.payload;
	if (!isAmbientPackPayload(payload)) {
		error(500, 'This ambient pack was stored in an unrecognised shape');
	}

	const placeSlug = await placeSlugFor(conn, artifact.subjectEntityId);
	const base = `/u/${event.params.universe}/e/${placeSlug}/media`;

	const layers: LayerView[] = payload.layers.map((layer) => ({
		id: layer.mediaAssetId,
		url: `${base}/${layer.mediaAssetId}`,
		prompt: layer.prompt,
		loopType: layer.loopType,
		intervalMinSeconds: layer.intervalMinSeconds ?? null,
		intervalMaxSeconds: layer.intervalMaxSeconds ?? null,
		volume: layer.volume,
		mimeType: layer.mimeType
	}));

	return json({
		id: artifact.id,
		description: payload.description,
		stale: artifact.stale,
		layers
	});
};
