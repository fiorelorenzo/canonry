/**
 * The `image_store` half of the tool surface (SPEC.md §6.3): "store an image found in
 * the export, returns an asset id to attach. Images are stored, not referenced: a
 * source that disappears must not take the pictures with it." The real implementation -
 * writing to the app's media storage and returning a stable `media_asset` id - is issue
 * #40. This module defines the seam and an in-memory double for tests.
 */

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

/** In-memory test double (issue #40 stands in for the real media store). */
export class InMemoryImageStore implements ImageStore {
	private readonly stored: StoredImage[] = [];
	private nextId = 1;

	async store(input: {
		sourcePath: string;
		mimeType: string;
		base64: string;
	}): Promise<{ assetId: string }> {
		const assetId = `asset-${this.nextId++}`;
		this.stored.push({ assetId, mimeType: input.mimeType, base64: input.base64 });
		return { assetId };
	}

	all(): readonly StoredImage[] {
		return this.stored;
	}
}
