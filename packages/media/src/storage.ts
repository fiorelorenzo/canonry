/**
 * File storage for generated media (#66; media_asset.path's schema comment: "under the
 * media root, not a URL - the file is served by the app behind Caddy"). Filesystem-backed,
 * one directory per universe and kind, filenames are random ids so two GMs generating a
 * portrait at the same moment never collide on a name.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MediaKind } from '@canonry/db/schema';

export interface StoredFile {
	/** Relative to the storage root - exactly what media_asset.path stores in the
	 * database, never an absolute filesystem path. */
	path: string;
	bytes: number;
}

export interface SaveMediaInput {
	universeId: string;
	kind: MediaKind;
	mimeType: string;
	bytes: Uint8Array;
}

export interface MediaStorage {
	save(input: SaveMediaInput): Promise<StoredFile>;
	read(relativePath: string): Promise<Uint8Array>;
}

const EXTENSION_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	// #68: ElevenLabs' sound-generation endpoint returns mp3 by default; FakeAudioProvider
	// returns a real wav tone (../audio/provider.ts's tinyWavBytes) so tests never touch
	// the network.
	'audio/mpeg': 'mp3',
	'audio/wav': 'wav'
};

function extensionFor(mimeType: string): string {
	return EXTENSION_BY_MIME[mimeType] ?? 'bin';
}

export class PathEscapeError extends Error {
	constructor(relativePath: string) {
		super(`media path "${relativePath}" resolves outside the storage root`);
		this.name = 'PathEscapeError';
	}
}

export class FilesystemMediaStorage implements MediaStorage {
	constructor(private readonly root: string) {}

	async save(input: SaveMediaInput): Promise<StoredFile> {
		const relative = path.join(
			input.universeId,
			input.kind,
			`${randomUUID()}.${extensionFor(input.mimeType)}`
		);
		const absolute = this.resolve(relative);
		await mkdir(path.dirname(absolute), { recursive: true });
		await writeFile(absolute, input.bytes);
		return { path: relative, bytes: input.bytes.byteLength };
	}

	async read(relativePath: string): Promise<Uint8Array> {
		return readFile(this.resolve(relativePath));
	}

	/** Rejects a stored path that would resolve outside the root - media_asset.path is
	 * database-supplied, and a row that ever ends up with `../../etc/passwd` in it must
	 * never turn into a filesystem read outside the media root. */
	private resolve(relativePath: string): string {
		const rootAbsolute = path.resolve(this.root);
		const absolute = path.resolve(rootAbsolute, relativePath);
		if (absolute !== rootAbsolute && !absolute.startsWith(rootAbsolute + path.sep)) {
			throw new PathEscapeError(relativePath);
		}
		return absolute;
	}
}

/** No .env in this repo sets MEDIA_ROOT yet (see .env.example) - defaults to a
 * repo-relative .data/media directory for local dev, the same shape as every other
 * server helper here that falls back to a loopback/local default when unconfigured. */
export function readMediaRoot(env: NodeJS.ProcessEnv = process.env): string {
	return env.MEDIA_ROOT ?? path.join(process.cwd(), '.data', 'media');
}
