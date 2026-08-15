/**
 * Renders the world into every source format and writes the exports to disk.
 *
 *   pnpm --filter @canonry/bench corpus
 *
 * Two revisions of every format: `v1` is the export a GM hands over on day one, `v2` is
 * what the same world looks like a month later, which is what SPEC.md §6.4's "re-import
 * must update, never duplicate" is measured against. Both are written as a loose file
 * tree, so a human can read them, and as a zip, because that is what the upload path
 * actually takes.
 *
 * Everything here is deterministic: the renderers take no timestamps and no randomness, so
 * building twice produces byte-identical archives and a diff between two runs is a real
 * change rather than noise. The one exception is the zip container's own metadata, which
 * is why the manifest, not the archive, is what anything downstream compares.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { dataDir } from '../env.js';
import { renderObsidian } from './render/obsidian.js';
import { renderKanka } from './render/kanka.js';
import { renderWorldAnvil } from './render/world-anvil.js';
import { renderPdf } from './render/pdf.js';
import { renderDocx } from './render/docx.js';
import { renderGeneric } from './render/generic.js';
import { renderOneNote } from './render/onenote.js';
import { worldV1, worldV2 } from './valdoria-reach.js';
import type { DocumentExpectation, Renderer, World } from './types.js';

/** Keyed by the directory the export lands in, which is also how every downstream runner
 * names it. `onenote` renders with the `generic` playbook (SPEC.md §6.6 routes OneNote
 * through the generic path), so the key and the playbook deliberately differ for it. */
export const RENDERERS: Record<string, Renderer> = {
	obsidian: renderObsidian,
	kanka: renderKanka,
	'world-anvil': renderWorldAnvil,
	pdf: renderPdf,
	docx: renderDocx,
	generic: renderGeneric,
	onenote: renderOneNote
};

export interface CorpusManifest {
	source: string;
	revision: 'v1' | 'v2';
	playbook: string;
	fileCount: number;
	totalBytes: number;
	documents: DocumentExpectation[];
}

export const corpusRoot = path.join(dataDir, 'corpus');

export function exportDir(source: string, revision: 'v1' | 'v2'): string {
	return path.join(corpusRoot, source, revision);
}

export function archivePath(source: string, revision: 'v1' | 'v2'): string {
	return path.join(corpusRoot, source, `${revision}.zip`);
}

export function manifestPath(source: string, revision: 'v1' | 'v2'): string {
	return path.join(corpusRoot, source, `${revision}.manifest.json`);
}

async function buildOne(
	source: string,
	renderer: Renderer,
	world: World,
	revision: 'v1' | 'v2'
): Promise<CorpusManifest> {
	const rendered = await renderer(world);
	const dir = exportDir(source, revision);
	rmSync(dir, { recursive: true, force: true });

	const zipEntries: Record<string, Uint8Array> = {};
	let totalBytes = 0;
	for (const file of rendered.files) {
		const target = path.join(dir, file.path);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, file.bytes);
		zipEntries[file.path] = file.bytes;
		totalBytes += file.bytes.byteLength;
	}

	// `level: 0` keeps the archive reproducible across zlib versions and costs nothing:
	// these are fixtures read once by a test, not something anyone downloads.
	writeFileSync(archivePath(source, revision), zipSync(zipEntries, { level: 0 }));

	const manifest: CorpusManifest = {
		source,
		revision,
		playbook: rendered.playbook,
		fileCount: rendered.files.length,
		totalBytes,
		documents: rendered.documents
	};
	writeFileSync(manifestPath(source, revision), JSON.stringify(manifest, null, '\t'));
	return manifest;
}

export async function buildCorpus(sources = Object.keys(RENDERERS)): Promise<CorpusManifest[]> {
	const manifests: CorpusManifest[] = [];
	for (const source of sources) {
		const renderer = RENDERERS[source];
		if (!renderer) throw new Error(`no renderer for source "${source}"`);
		mkdirSync(path.join(corpusRoot, source), { recursive: true });
		manifests.push(await buildOne(source, renderer, worldV1, 'v1'));
		manifests.push(await buildOne(source, renderer, worldV2, 'v2'));
	}
	writeFileSync(
		path.join(corpusRoot, 'index.json'),
		JSON.stringify(
			{
				builtAt: new Date().toISOString(),
				worldV1: { entities: worldV1.entities.length, relations: worldV1.relations.length },
				worldV2: { entities: worldV2.entities.length, relations: worldV2.relations.length },
				manifests: manifests.map((m) => ({
					source: m.source,
					revision: m.revision,
					playbook: m.playbook,
					files: m.fileCount,
					documents: m.documents.length,
					bytes: m.totalBytes
				}))
			},
			null,
			'\t'
		)
	);
	return manifests;
}

if (process.argv[1] && process.argv[1].endsWith('build.ts')) {
	const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	const manifests = await buildCorpus(only.length > 0 ? only : undefined);
	const width = Math.max(...manifests.map((m) => m.source.length));
	for (const m of manifests) {
		console.log(
			`${m.source.padEnd(width)} ${m.revision}  playbook=${m.playbook.padEnd(12)} ` +
				`${String(m.fileCount).padStart(4)} files  ${String(m.documents.length).padStart(4)} docs  ` +
				`${(m.totalBytes / 1024).toFixed(0)} KB`
		);
	}
}
