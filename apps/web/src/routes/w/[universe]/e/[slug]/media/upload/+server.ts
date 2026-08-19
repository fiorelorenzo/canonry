/**
 * #252: a GM's own file - a map, a portrait commission, a photo of a hand-drawn dungeon
 * - has nowhere to go today, which is a hole in a product whose point is that the wiki is
 * good even with the AI switched off (guardrail 4). This is the multipart counterpart of
 * `media/generate`: same writer check, same storage seam, but nothing here ever calls a
 * model, so it charges nothing and writes no `model_call` row.
 *
 * Validation is deterministic and runs before anything is stored, same posture
 * `packages/import/src/archive.ts` already takes toward an uploaded file: a mime
 * allowlist, a byte ceiling, and the real bytes sniffed for a magic number rather than
 * the declared content type or the filename trusted. A refused upload stores nothing,
 * neither a file nor a row. `MAX_UPLOAD_BYTES` mirrors
 * `packages/import/src/media-store.ts`'s `DEFAULT_MEDIA_STORE_LIMITS.maxBytes` (25MB) by
 * value rather than by import - that module is internal to `@canonry/import` and not part
 * of its public `index.ts` surface.
 */
import { error, json } from '@sveltejs/kit';
import { createMediaAsset } from '@canonry/db';
import { messages } from '$lib/i18n';
import { mediaStorage } from '$lib/server/media';
import type { RequestHandler } from './$types';
import { loadMediaContext, requireWriter } from '../_context.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type AllowedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

function matchesMagic(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
	return (
		offset + signature.length <= bytes.length &&
		signature.every((byte, index) => bytes[offset + index] === byte)
	);
}

/** Detects the real format from the file's own bytes, never the declared content type or
 * the filename (#252's whole point). WEBP is a RIFF container - the four-byte "WEBP" tag
 * sits right after the 4-byte "RIFF" tag and the 4-byte chunk size, not at the very start,
 * so it needs a second offset check rather than one flat signature. */
function sniffImageMimeType(bytes: Uint8Array): AllowedImageMimeType | undefined {
	if (matchesMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (matchesMagic(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (
		matchesMagic(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		matchesMagic(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	)
		return 'image/webp';
	return undefined;
}

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);
	requireWriter(locals, context.role);
	const t = messages(locals.locale);

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, t.entry.media.upload.noFile);

	// `File.size` is known from the multipart part's own length, no need to buffer the
	// body first - a declared-oversize file is refused before a single byte is read.
	if (file.size > MAX_UPLOAD_BYTES) {
		error(413, t.entry.media.upload.tooLarge(Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))));
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const sniffed = sniffImageMimeType(bytes);
	if (!sniffed) error(415, t.entry.media.upload.unsupportedType);
	// The declared type is trusted only once it agrees with the bytes it is describing -
	// an image renamed or mislabeled to slip past a naive content-type check is refused
	// here rather than stored under a mime_type the file does not actually have.
	if (file.type && file.type !== sniffed) error(415, t.entry.media.upload.typeMismatch);

	const stored = await mediaStorage().save({
		universeId: context.universe.id,
		kind: 'image',
		mimeType: sniffed,
		bytes
	});

	// `generated: false`, `prompt`/`provider`/`modelId` all null: this file is not a
	// model's work, and must never carry the mark that says it is (schema comment on
	// `media_asset.generated`, packages/db/src/schema/media.ts). `publishedToPlayers` is
	// not passed - `createMediaAsset` does not even accept it as an input (guardrail 6).
	const asset = await createMediaAsset(context.conn, {
		universeId: context.universe.id,
		entityId: context.entity.id,
		kind: 'image',
		path: stored.path,
		mimeType: sniffed,
		bytes: stored.bytes,
		generated: false
	});

	return json({
		id: asset.id,
		mimeType: asset.mimeType,
		generated: asset.generated,
		createdAt: asset.createdAt
	});
};
