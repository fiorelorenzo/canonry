/**
 * The corpus has to be detected as what it is, or every end-to-end run measures the wrong
 * playbook.
 *
 * `apps/web/src/lib/server/onboarding.ts` owns `detectSource` and `documentsForPlaybook`,
 * and this package cannot import from `apps/web`. Rather than copy them, which would let
 * the copy drift and keep passing, the checks below read a rendered archive with the same
 * `ArchiveSourceReader` the app uses and assert the properties the app's own detection
 * keys on, each with the line of `onboarding.ts` it mirrors.
 *
 * Split in two (issue #185), because most of this file's checks only need the renderer's
 * in-memory output, not bytes on disk:
 *
 * - obsidian, kanka, world-anvil, generic and onenote are pure TS: their renderer runs
 *   right here and gets zipped in memory the same way `build.ts` zips it for real, so
 *   these run everywhere, including CI, with no built corpus.
 * - pdf and docx shell out to `pandoc`, `google-chrome` and `gs` (render/shell.ts), which
 *   CI does not install on purpose (issue #185's option 1, declined). Their checks stay
 *   behind `describe.skipIf(!built)` against `pnpm --filter @canonry/bench corpus`'s
 *   output in `packages/bench/.data/`, and refuse a corpus whose embedded renderer
 *   fingerprint (fingerprint.ts) disagrees with the current source, so a stale build
 *   fails with an instruction to rebuild rather than a content assertion that reads like
 *   a code regression.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { ArchiveSourceReader, DEFAULT_ARCHIVE_LIMITS } from '@canonry/import';
import { archivePath, manifestPath, RENDERERS, type CorpusManifest } from './build.js';
import { rendererFingerprint } from './fingerprint.js';
import { worldV1, worldV2 } from './valdoria-reach.js';

async function walk(reader: ArchiveSourceReader, prefix = ''): Promise<string[]> {
	const entries = await reader.list(prefix);
	const out: string[] = [];
	for (const entry of entries) {
		if (entry.kind === 'file') out.push(entry.path);
		else out.push(...(await walk(reader, entry.path)));
	}
	return out;
}

/** The shared assertions every source's shape check runs: the app's own `detectSource`
 * branch for that source (each comment names the `onboarding.ts` line it mirrors), plus
 * `documentsForPlaybook`'s promise that every document the manifest expects actually
 * exists in the archive. Shared between the in-memory and the on-disk suite below so the
 * two never drift into checking different things. */
async function assertDetectable(
	source: string,
	manifest: Pick<CorpusManifest, 'documents'>,
	paths: string[],
	reader: ArchiveSourceReader
): Promise<void> {
	expect(paths.length).toBeGreaterThan(0);

	if (source === 'obsidian') {
		// onboarding.ts:276, the first and strongest branch.
		expect(paths.some((p) => p.toLowerCase().split('/').includes('.obsidian'))).toBe(true);
	}
	if (source === 'kanka') {
		// onboarding.ts:249, looksLikeKankaExport: a JSON array whose records carry
		// `entity_type`. Checked on every JSON file, not only the first six the app
		// samples, because a file the app happens not to sample still has to be one.
		const jsonPaths = paths.filter((p) => p.toLowerCase().endsWith('.json'));
		expect(jsonPaths.length).toBeGreaterThan(0);
		for (const p of jsonPaths) {
			const parsed: unknown = JSON.parse((await reader.read(p)).content);
			expect(Array.isArray(parsed), `${p} is not a JSON array`).toBe(true);
			expect(
				(parsed as unknown[]).some(
					(r) => typeof r === 'object' && r !== null && 'entity_type' in r
				),
				`${p} carries no entity_type`
			).toBe(true);
		}
	}
	if (source === 'world-anvil') {
		// onboarding.ts:294, both folders present at the archive root.
		const lower = paths.map((p) => p.toLowerCase());
		expect(lower.some((p) => p.startsWith('json/'))).toBe(true);
		expect(lower.some((p) => p.startsWith('html/'))).toBe(true);
	}
	if (source === 'pdf' || source === 'docx') {
		// onboarding.ts:313 and :316 are single-file branches; docx renders two
		// documents on purpose (one per language), so only the extension is asserted.
		expect(paths.every((p) => p.toLowerCase().endsWith(`.${source}`))).toBe(true);
	}
	if (source === 'onenote') {
		// onboarding.ts's onenote branch in detectSource: a tree of .htm/.html pages,
		// at least one with a sibling "<page>_files/" folder for its own embedded
		// attachments - OneNote's own GetHierarchy/Publish export shape, and no other
		// shipped source mimics it.
		const htmlPaths = paths.filter((p) => /\.html?$/i.test(p));
		expect(htmlPaths.length).toBeGreaterThan(0);
		expect(paths.some((p) => p.includes('_files/'))).toBe(true);
	}

	// documentsForPlaybook, onboarding.ts:332. Every document the manifest promises has to
	// exist in the archive under exactly that path, or the end-to-end run asks the reader
	// for something that is not there.
	for (const doc of manifest.documents) {
		expect(paths, `${doc.sourcePath} is promised but not in the archive`).toContain(
			doc.sourcePath
		);
	}
}

// ---------------------------------------------------------------------------------------
// In memory: no `pnpm --filter @canonry/bench corpus`, no `.data/`, runs everywhere.
// ---------------------------------------------------------------------------------------

const IN_MEMORY_SOURCES = Object.keys(RENDERERS).filter((s) => s !== 'pdf' && s !== 'docx');
const worldByRevision = { v1: worldV1, v2: worldV2 };

async function renderInMemory(
	source: string,
	revision: 'v1' | 'v2'
): Promise<{ manifest: CorpusManifest; paths: string[]; reader: ArchiveSourceReader }> {
	const renderer = RENDERERS[source];
	if (!renderer) throw new Error(`no renderer for source "${source}"`);
	const rendered = await renderer(worldByRevision[revision]);

	// The same zip build.ts writes to disk, just never written: what ArchiveSourceReader
	// reads is the archive shape, which depends only on these entries.
	const zipEntries: Record<string, Uint8Array> = {};
	let totalBytes = 0;
	for (const file of rendered.files) {
		zipEntries[file.path] = file.bytes;
		totalBytes += file.bytes.byteLength;
	}
	const archive = zipSync(zipEntries, { level: 0 });
	const manifest: CorpusManifest = {
		source,
		revision,
		playbook: rendered.playbook,
		fileCount: rendered.files.length,
		totalBytes,
		documents: rendered.documents
	};
	const reader = ArchiveSourceReader.open(archive, DEFAULT_ARCHIVE_LIMITS);
	const paths = await walk(reader);
	return { manifest, paths, reader };
}

describe('the rendered corpus (in memory)', () => {
	for (const source of IN_MEMORY_SOURCES) {
		for (const revision of ['v1', 'v2'] as const) {
			it(`${source} ${revision} is shaped the way its playbook is detected`, async () => {
				const { manifest, paths, reader } = await renderInMemory(source, revision);
				await assertDetectable(source, manifest, paths, reader);
			});
		}
	}

	it('onenote is detected as its own playbook and enumerates every page (issue #162)', async () => {
		// Fixed: KNOWN_PLAYBOOK_IDS carried no `onenote` entry, so an uploaded export fell
		// through detectSource to `generic`, and documentsForPlaybook('generic', ...)
		// enumerates only .md/.txt - a well-formed export imported nothing, silently.
		// detectSource now recognises the .htm/_files tree shape and documentsForPlaybook
		// enumerates one document per page (apps/web/src/lib/server/onboarding.test.ts
		// exercises those two functions directly; this only checks that the renderer's own
		// manifest promises exactly the real pages in the archive - neither more, which
		// would mean a phantom document, nor fewer, which is this issue's own bug).
		const { manifest, paths } = await renderInMemory('onenote', 'v1');
		const htmlPaths = paths.filter((p) => /\.html?$/i.test(p));

		expect(manifest.playbook).toBe('onenote');
		expect(manifest.documents.length).toBeGreaterThan(0);
		expect(manifest.documents.map((d) => d.sourcePath).sort()).toEqual([...htmlPaths].sort());
	});
});

// ---------------------------------------------------------------------------------------
// On disk: pdf and docx shell out to pandoc/google-chrome/gs (render/shell.ts), so their
// bytes only exist once `pnpm --filter @canonry/bench corpus` has produced them locally.
// ---------------------------------------------------------------------------------------

const DISK_ONLY_SOURCES = ['pdf', 'docx'] as const;
const built = DISK_ONLY_SOURCES.every(
	(s) => existsSync(archivePath(s, 'v1')) && existsSync(archivePath(s, 'v2'))
);

/** Reads the built manifest and throws, before any content assertion runs, if its
 * embedded renderer fingerprint disagrees with the current source (issue #185): the
 * message this throws is the only failure a stale corpus should produce, not a second,
 * confusing mismatch against expectations the renderer has since changed underneath it. */
function loadFreshManifest(
	source: (typeof DISK_ONLY_SOURCES)[number],
	revision: 'v1' | 'v2'
): CorpusManifest {
	const manifest = JSON.parse(
		readFileSync(manifestPath(source, revision), 'utf8')
	) as CorpusManifest;
	const current = rendererFingerprint(source);
	if (manifest.rendererFingerprint !== current) {
		throw new Error(
			`${source} ${revision}'s built corpus predates the renderer that produced it. ` +
				'Rebuild it: pnpm --filter @canonry/bench corpus'
		);
	}
	return manifest;
}

describe.skipIf(!built)('the built corpus (pdf, docx)', () => {
	for (const source of DISK_ONLY_SOURCES) {
		for (const revision of ['v1', 'v2'] as const) {
			it(`${source} ${revision} is shaped the way its playbook is detected`, async () => {
				const manifest = loadFreshManifest(source, revision);
				const reader = ArchiveSourceReader.open(
					readFileSync(archivePath(source, revision)),
					DEFAULT_ARCHIVE_LIMITS
				);
				const paths = await walk(reader);
				await assertDetectable(source, manifest, paths, reader);
			});
		}
	}
});
