/**
 * The real `ImageStore` (issue #40, SPEC.md §6.3, §6.6): "store an image found in the
 * export, returns an asset id to attach. Images are stored, not referenced: a source
 * that disappears must not take the pictures with it." `store` writes the bytes onto
 * the app's own media root and inserts one `media_asset` row pointing at that copy -
 * after this returns, the job's unpacked export (and the archive it came from) can be
 * discarded without taking the image with it.
 *
 * Two guardrails from SPEC.md §9 apply here even though this is an import path, not a
 * generation path:
 * - `published_to_players` stays at its schema default of `false` (guardrail 6) - this
 *   module never sets it, the same way `@canonry/db`'s `createMediaAsset` never accepts
 *   it as an input.
 * - `generated` is explicitly `false` - an imported image is not a generation, and
 *   nothing else about the row (`prompt`, `provider`, `modelId`) applies to it.
 *
 * Scoped to exactly one job's universe by construction, the same way `ArchiveSourceReader`
 * is scoped to exactly one job's export (sources.ts): there is no universe id on
 * `ImageStore.store`'s own call signature, so a `MediaAssetImageStore` is built once per
 * job with the universe id already fixed in.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '@canonry/db';
import { mediaAsset } from '@canonry/db/schema';
import type { ImageStore } from './images.js';

export class ImageTooLargeError extends Error {
	constructor(sourcePath: string, byteLength: number, maxBytes: number) {
		super(`"${sourcePath}" is ${byteLength} bytes, over the ${maxBytes} byte limit`);
		this.name = 'ImageTooLargeError';
	}
}

export class ImageDimensionsTooLargeError extends Error {
	constructor(sourcePath: string, width: number, height: number, maxPixels: number) {
		super(
			`"${sourcePath}" declares ${width}x${height} (${width * height} pixels), over the ` +
				`${maxPixels} pixel limit`
		);
		this.name = 'ImageDimensionsTooLargeError';
	}
}

export class ImageDecodeError extends Error {
	constructor(sourcePath: string, format: string) {
		super(`"${sourcePath}" claims to be a ${format} image but its header could not be read`);
		this.name = 'ImageDecodeError';
	}
}

export interface MediaStoreLimits {
	/** Stored byte count, checked against the decoded (post-base64) buffer. */
	maxBytes: number;
	/** Declared width * height from the image's own header, checked before any pixel
	 * data is ever decoded - the same "reject from the header, before inflating"
	 * defense archive.ts's zip-bomb guards use. */
	maxDecodedPixels: number;
}

/** 25MB comfortably covers any real scanned page, photograph or illustration a GM's
 * export would carry - well above a 300 DPI A4 scan (a few MB) - while still bounding a
 * single upload. 40 megapixels comfortably covers a 24MP DSLR photo (~6000x4000) or a
 * 300 DPI scan of a large-format (11x17in) page (~34MP), with headroom, while still
 * rejecting a header that declares an absurd canvas purely to exhaust memory on decode. */
export const DEFAULT_MEDIA_STORE_LIMITS: MediaStoreLimits = {
	maxBytes: 25 * 1024 * 1024,
	maxDecodedPixels: 40_000_000
};

interface SniffedImage {
	format: 'png' | 'jpeg' | 'gif' | 'bmp';
	width: number;
	height: number;
}

/** PNG: an 8-byte signature, then the `IHDR` chunk is always first and always 25 bytes
 * (4 length + 4 type + 4 width + 4 height + 5 more), so width/height sit at fixed
 * offsets - no need to walk chunks. */
function sniffPng(bytes: Uint8Array): SniffedImage | undefined {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || !signature.every((byte, index) => bytes[index] === byte))
		return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { format: 'png', width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/** JPEG: a sequence of `0xFF <marker>` segments. Width/height live in the first
 * Start-Of-Frame marker (`0xC0`-`0xCF`, excluding the DHT/JPG/DAC reserved markers),
 * two bytes each, five bytes into that segment's payload. Markers with no length
 * (`0xD0`-`0xD9`, `0x01`) are skipped without reading a length field for them. */
function sniffJpeg(bytes: Uint8Array): SniffedImage | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return undefined;
		const marker = bytes[offset + 1];
		if (marker === undefined || marker === 0xd8 || marker === 0xd9) break;
		const isStandaloneMarker = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
		if (isStandaloneMarker) {
			offset += 2;
			continue;
		}
		const segmentLength = view.getUint16(offset + 2, false);
		const isStartOfFrame =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isStartOfFrame) {
			if (offset + 9 > bytes.length) return undefined;
			return {
				format: 'jpeg',
				height: view.getUint16(offset + 5, false),
				width: view.getUint16(offset + 7, false)
			};
		}
		offset += 2 + segmentLength;
	}
	return undefined;
}

/** GIF: a 6-byte signature (`GIF87a`/`GIF89a`), then a 2-byte little-endian width and
 * 2-byte little-endian height, always at a fixed offset. */
function sniffGif(bytes: Uint8Array): SniffedImage | undefined {
	const isGif87 =
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		bytes[4] === 0x37 &&
		bytes[5] === 0x61;
	const isGif89 =
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		bytes[4] === 0x39 &&
		bytes[5] === 0x61;
	if (bytes.length < 10 || !(isGif87 || isGif89)) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { format: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/** BMP: a 2-byte `BM` signature, then the DIB header's width/height at a fixed offset
 * (bytes 18-25, signed little-endian 32-bit each). A negative height means a top-down
 * bitmap - the pixel count is the same either way. */
function sniffBmp(bytes: Uint8Array): SniffedImage | undefined {
	if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		format: 'bmp',
		width: Math.abs(view.getInt32(18, true)),
		height: Math.abs(view.getInt32(22, true))
	};
}

/** Detects the real format from magic bytes (never trusting the caller-supplied
 * `mimeType`, which `ArchiveSourceReader.readBinary` only ever guesses from a file
 * extension) and reads its declared pixel dimensions straight from the header, without
 * decoding a single pixel. WEBP and SVG are deliberately not sniffed here: WEBP's
 * lossy/lossless bitstreams need real bit-level parsing this module does not implement
 * (a real gap - such an image only gets the byte-size guard below, not the pixel-count
 * one); SVG is vector, so "decoded pixel count" does not apply to it at all. */
function sniffImageDimensions(bytes: Uint8Array): SniffedImage | undefined {
	return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffBmp(bytes);
}

const KNOWN_MAGIC_BYTES: Record<string, readonly number[]> = {
	png: [0x89, 0x50, 0x4e, 0x47],
	jpeg: [0xff, 0xd8],
	gif: [0x47, 0x49, 0x46],
	bmp: [0x42, 0x4d]
};

/** True when `bytes` starts with a known raster format's magic bytes but that format's
 * own sniffer above still failed to read it - i.e. the file is truncated or corrupt,
 * not merely a format this module does not sniff (WEBP/SVG). Storing a corrupt image
 * nobody can ever decode is a silent failure worth refusing loudly instead. */
function looksLikeCorruptKnownFormat(bytes: Uint8Array): string | undefined {
	for (const [format, magic] of Object.entries(KNOWN_MAGIC_BYTES)) {
		if (magic.every((byte, index) => bytes[index] === byte)) return format;
	}
	return undefined;
}

const EXTENSION_BY_FORMAT: Record<string, string> = {
	png: 'png',
	jpeg: 'jpg',
	gif: 'gif',
	bmp: 'bmp'
};
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
	'image/webp': 'webp',
	'image/svg+xml': 'svg'
};

export interface MediaAssetImageStoreOptions {
	db: Db;
	/** The one universe this job's images belong to (SPEC.md §6.1: "never the whole
	 * world"), fixed once at construction rather than passed per call. */
	universeId: string;
	/** The app's media root - files are written under
	 * `<mediaRoot>/<universeId>/imported/<random-id>.<ext>`. */
	mediaRoot: string;
	limits?: MediaStoreLimits;
}

export class MediaAssetImageStore implements ImageStore {
	private readonly db: Db;
	private readonly universeId: string;
	private readonly mediaRoot: string;
	private readonly limits: MediaStoreLimits;

	constructor(options: MediaAssetImageStoreOptions) {
		this.db = options.db;
		this.universeId = options.universeId;
		this.mediaRoot = options.mediaRoot;
		this.limits = options.limits ?? DEFAULT_MEDIA_STORE_LIMITS;
	}

	async store(input: {
		sourcePath: string;
		mimeType: string;
		base64: string;
	}): Promise<{ assetId: string }> {
		const bytes = Buffer.from(input.base64, 'base64');
		if (bytes.byteLength > this.limits.maxBytes) {
			throw new ImageTooLargeError(input.sourcePath, bytes.byteLength, this.limits.maxBytes);
		}

		const sniffed = sniffImageDimensions(bytes);
		if (sniffed) {
			const pixels = sniffed.width * sniffed.height;
			if (pixels > this.limits.maxDecodedPixels) {
				throw new ImageDimensionsTooLargeError(
					input.sourcePath,
					sniffed.width,
					sniffed.height,
					this.limits.maxDecodedPixels
				);
			}
		} else {
			const corruptFormat = looksLikeCorruptKnownFormat(bytes);
			if (corruptFormat) throw new ImageDecodeError(input.sourcePath, corruptFormat);
		}

		const extension =
			(sniffed && EXTENSION_BY_FORMAT[sniffed.format]) ??
			EXTENSION_BY_MIME_TYPE[input.mimeType] ??
			'bin';
		// A random filename, never anything derived from `sourcePath` (the path inside the
		// job's own export) - two documents in the same job can carry an image at the same
		// relative path without colliding on disk.
		const relativePath = path.join(this.universeId, 'imported', `${randomUUID()}.${extension}`);
		const absolutePath = path.join(this.mediaRoot, relativePath);
		await mkdir(path.dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, bytes);

		const [inserted] = await this.db
			.insert(mediaAsset)
			.values({
				universeId: this.universeId,
				entityId: null,
				kind: 'image',
				path: relativePath,
				mimeType: input.mimeType,
				bytes: bytes.byteLength,
				generated: false
				// publishedToPlayers, prompt, provider, modelId, similarityKey and credits are
				// all left at their schema defaults (false / null / null / null / null / 0) -
				// an imported image is not a generation and starts unpublished, same as
				// @canonry/db's own createMediaAsset never accepting publishedToPlayers as input.
			})
			.returning();
		if (!inserted) throw new Error('MediaAssetImageStore: insert returned no row');
		return { assetId: inserted.id };
	}
}

/** Mirrors `@canonry/media`'s `readMediaRoot` (packages/media/src/storage.ts) exactly -
 * same env var, same repo-relative default - not imported from that package because
 * packages/import does not depend on it and adding that dependency needs `pnpm install`. */
export function readMediaRoot(env: NodeJS.ProcessEnv = process.env): string {
	return env.MEDIA_ROOT ?? path.join(process.cwd(), '.data', 'media');
}
