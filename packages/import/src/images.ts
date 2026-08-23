/**
 * The `image_store` half of the tool surface (SPEC.md §6.3): "store an image found in
 * the export, returns an asset id to attach. Images are stored, not referenced: a
 * source that disappears must not take the pictures with it." The real implementation -
 * writing to the app's media storage and returning a stable `media_asset` id - is issue
 * #40. This module defines the seam and an in-memory double for tests.
 */

function matchesMagic(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
	return (
		offset + signature.length <= bytes.length &&
		signature.every((byte, index) => bytes[offset + index] === byte)
	);
}

/** issue #623: the set the rest of the product knows. `AllowedImageMimeType` in
 * `apps/web/src/routes/w/[universe]/e/[slug]/media/upload/+server.ts`, that route's own
 * `sniffImageMimeType`, `MediaGallery.svelte`'s picker and `@canonry/media`'s
 * `EXTENSION_BY_MIME` all name exactly these three, and the import path used to be the
 * one place that did not: `MediaAssetImageStore.store` validated no mime type at all, so
 * an export could put a GIF, a BMP, an SVG or anything else into `media_asset` and the
 * same file could then not be uploaded by hand on the entry it belonged to.
 *
 * It narrows rather than widens, and SVG is the reason the choice is not symmetric. An
 * SVG is a document, not a bitmap: serving a user-supplied one from our own origin is a
 * script-execution surface, so widening to it is a security decision rather than a format
 * decision, and the answer to that would be to rasterise on ingest or to serve it from a
 * separate origin, never to store and serve it as-is. Narrowing costs a GM a picture out
 * of an export they did not choose to lose, which is why a refused image is reported to
 * them (`image_skipped`, carried into `outcome_note`) rather than dropped in silence, and
 * it is reversible in a way that opening that surface is not.
 *
 * This lives on the seam rather than in `media-store.ts` for two reasons: `tools.ts` has
 * to recognise a refusal in order to report it, and `InMemoryImageStore` below has to
 * refuse exactly what the real store refuses, or every test that runs against the double
 * is exercising a policy production does not have. Neither should need to import a
 * Postgres-backed implementation to get there. */
export const SUPPORTED_IMPORT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type SupportedImportImageMimeType = (typeof SUPPORTED_IMPORT_IMAGE_MIME_TYPES)[number];

/** The real format from the file's own bytes, never a caller-supplied `mimeType`, which
 * `ArchiveSourceReader.readBinary` only ever guesses from a file extension. Same three
 * signatures the upload route sniffs, deliberately: WEBP is a RIFF container, so its
 * four-byte "WEBP" tag sits after the "RIFF" tag and the chunk size rather than at the
 * start, and needs a second offset check. */
export function sniffSupportedMimeType(
	bytes: Uint8Array
): SupportedImportImageMimeType | undefined {
	if (matchesMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (matchesMagic(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (
		matchesMagic(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		matchesMagic(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	)
		return 'image/webp';
	return undefined;
}

/** Names a refused file's real format, so the GM is told what was skipped rather than
 * only that something was. Best effort by design: an unrecognised file comes back
 * undefined and the caller falls back to the export's own guess. SVG is text, so it is
 * sniffed by its root element after any leading whitespace or XML declaration rather
 * than by a magic number. */
export function describeRefusedFormat(bytes: Uint8Array): string | undefined {
	if (matchesMagic(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
	if (matchesMagic(bytes, [0x42, 0x4d])) return 'image/bmp';
	if (
		matchesMagic(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
		matchesMagic(bytes, [0x4d, 0x4d, 0x00, 0x2a])
	)
		return 'image/tiff';
	const head = new TextDecoder('utf-8', { fatal: false })
		.decode(bytes.subarray(0, 512))
		.trimStart();
	if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
		return 'image/svg+xml';
	return undefined;
}

/** The one refusal a GM can act on, so it carries the path and the format rather than
 * only a message: "skipped a GIF" is useful and "skipped something" is not. */
export class UnsupportedImageFormatError extends Error {
	readonly sourcePath: string;
	readonly format: string;

	constructor(sourcePath: string, format: string) {
		super(
			`"${sourcePath}" is ${format}, which Canonry does not store - only ` +
				`${SUPPORTED_IMPORT_IMAGE_MIME_TYPES.join(', ')}`
		);
		this.name = 'UnsupportedImageFormatError';
		this.sourcePath = sourcePath;
		this.format = format;
	}
}

export interface StoredImage {
	assetId: string;
	mimeType: string;
	base64: string;
}

export interface ImageStore {
	store(input: {
		sourcePath: string;
		mimeType: string;
		base64: string;
	}): Promise<{ assetId: string }>;
}

/** In-memory test double (issue #40 stands in for the real media store). It applies the
 * same format refusal and records the same sniffed mime type as `MediaAssetImageStore`,
 * so a test that drives the tool surface against this double sees production's behaviour
 * rather than a permissive stand-in (#623). */
export class InMemoryImageStore implements ImageStore {
	private readonly stored: StoredImage[] = [];
	private nextId = 1;

	async store(input: {
		sourcePath: string;
		mimeType: string;
		base64: string;
	}): Promise<{ assetId: string }> {
		const bytes = new Uint8Array(Buffer.from(input.base64, 'base64'));
		const mimeType = sniffSupportedMimeType(bytes);
		if (!mimeType) {
			throw new UnsupportedImageFormatError(
				input.sourcePath,
				describeRefusedFormat(bytes) ?? input.mimeType
			);
		}
		const assetId = `asset-${this.nextId++}`;
		this.stored.push({ assetId, mimeType, base64: input.base64 });
		return { assetId };
	}

	all(): readonly StoredImage[] {
		return this.stored;
	}
}
