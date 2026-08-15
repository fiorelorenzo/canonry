/**
 * The corpus has to be detected as what it is, or every end-to-end run measures the wrong
 * playbook.
 *
 * `apps/web/src/lib/server/onboarding.ts` owns `detectSource` and `documentsForPlaybook`,
 * and this package cannot import from `apps/web`. Rather than copy them, which would let
 * the copy drift and keep passing, the checks below read the built archives with the same
 * `ArchiveSourceReader` the app uses and assert the properties the app's own detection
 * keys on, each with the line of `onboarding.ts` it mirrors. If somebody changes the
 * detection rules, these stop describing reality and the end-to-end run says so on the
 * next line.
 *
 * Needs `pnpm --filter @canonry/bench corpus` to have run. Skipped, loudly, when it has
 * not: this is a check on generated artefacts, not on source.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArchiveSourceReader, DEFAULT_ARCHIVE_LIMITS } from '@canonry/import';
import { archivePath, manifestPath, RENDERERS, type CorpusManifest } from './build.js';

async function walk(reader: ArchiveSourceReader, prefix = ''): Promise<string[]> {
	const entries = await reader.list(prefix);
	const out: string[] = [];
	for (const entry of entries) {
		if (entry.kind === 'file') out.push(entry.path);
		else out.push(...(await walk(reader, entry.path)));
	}
	return out;
}

const sources = Object.keys(RENDERERS);
const built = sources.every((s) => existsSync(archivePath(s, 'v1')));

describe.skipIf(!built)('the built corpus', () => {
	for (const source of sources) {
		for (const revision of ['v1', 'v2'] as const) {
			it(`${source} ${revision} is shaped the way its playbook is detected`, async () => {
				const manifest = JSON.parse(
					readFileSync(manifestPath(source, revision), 'utf8')
				) as CorpusManifest;
				const reader = ArchiveSourceReader.open(
					readFileSync(archivePath(source, revision)),
					DEFAULT_ARCHIVE_LIMITS
				);
				const paths = await walk(reader);
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

				// documentsForPlaybook, onboarding.ts:332. Every document the manifest promises
				// has to exist in the archive under exactly that path, or the end-to-end run
				// asks the reader for something that is not there.
				for (const doc of manifest.documents) {
					expect(paths, `${doc.sourcePath} is promised but not in the archive`).toContain(
						doc.sourcePath
					);
				}
			});
		}
	}

	it('onenote yields no documents, which is the finding rather than the fixture', async () => {
		// SPEC.md §6.6 routes OneNote through the generic path, and `KNOWN_PLAYBOOK_IDS`
		// carries no `onenote` entry. But `documentsForPlaybook('generic', ...)` enumerates
		// only `.md` and `.txt` (onboarding.ts:358), and a OneNote export is `.htm`. So the
		// export below is real, well-formed, and imports nothing at all. This asserts the
		// broken behaviour on purpose: when somebody fixes it, this test fails and points at
		// the issue.
		const manifest = JSON.parse(
			readFileSync(manifestPath('onenote', 'v1'), 'utf8')
		) as CorpusManifest;
		const reader = ArchiveSourceReader.open(
			readFileSync(archivePath('onenote', 'v1')),
			DEFAULT_ARCHIVE_LIMITS
		);
		const paths = await walk(reader);
		expect(paths.some((p) => p.toLowerCase().endsWith('.htm'))).toBe(true);
		expect(paths.filter((p) => /\.(md|txt)$/i.test(p))).toHaveLength(0);
		expect(manifest.documents).toHaveLength(0);
	});
});
