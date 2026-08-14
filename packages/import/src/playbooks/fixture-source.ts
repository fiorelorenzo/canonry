/**
 * Test-only helper (issue #46): loads a checked-in fixture directory - a small, real
 * export under `packages/import/test/fixtures/<playbook>/` - into an `InMemorySourceReader`
 * so a playbook's own test can drive `GatewayDriver` exactly like gateway-driver.test.ts
 * does, without a real archive reader (issue #25, owned elsewhere; see sources.ts's own
 * comment on `InMemorySourceReader` standing in for it).
 *
 * Every text-ish file (Markdown, JSON, HTML, plain text) becomes a `source_read` entry
 * keyed by its path relative to the fixture root, exactly as the real unpacked export
 * would present it. Everything else (images) becomes a `readBinary`/`image_store` entry.
 * This mirrors what a real `SourceReader` over an unzipped export would return; PDF and
 * DOCX fixtures do not go through this loader; their extracted text has to come from a
 * real reader that does not exist yet (issue #39), so their tests supply pre-extracted
 * text and rendered pages directly instead of pretending this loader produced them.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemorySourceReader, type RenderedPage } from '../sources.js';

const TEXT_EXTENSIONS: Record<string, true> = {
	'.md': true,
	'.json': true,
	'.html': true,
	'.htm': true,
	'.txt': true
};

const BINARY_MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp'
};

/** Walks `rootDir` recursively and builds the `files`/`binaries` maps `InMemorySourceReader`
 * takes, keyed by POSIX-style paths relative to `rootDir` (never the host's absolute path,
 * since a document's `sourceRef.path` has to match what the export itself contains). */
export async function loadFixtureSourceReader(
	rootDir: string,
	options: { pages?: Record<string, RenderedPage> } = {}
): Promise<InMemorySourceReader> {
	const files: Record<string, string> = {};
	const binaries: Record<string, { mimeType: string; base64: string }> = {};

	async function walk(dir: string, prefix: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const absolute = join(dir, entry.name);
			const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				await walk(absolute, relative);
				continue;
			}
			const dot = entry.name.lastIndexOf('.');
			const ext = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
			if (TEXT_EXTENSIONS[ext]) {
				files[relative] = await readFile(absolute, 'utf8');
			} else {
				const mimeType = BINARY_MIME_TYPES[ext];
				if (!mimeType) {
					throw new Error(
						`fixture file "${relative}" has an extension this loader does not know how to type: ${ext}`
					);
				}
				const buffer = await readFile(absolute);
				binaries[relative] = { mimeType, base64: buffer.toString('base64') };
			}
		}
	}

	await walk(rootDir, '');
	return new InMemorySourceReader({
		files,
		binaries,
		...(options.pages ? { pages: options.pages } : {})
	});
}
