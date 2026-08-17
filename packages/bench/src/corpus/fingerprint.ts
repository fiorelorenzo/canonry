/**
 * A cheap "has anything that decides what this source's bytes look like changed since it
 * was built" check, for the two renderers a test cannot call itself: `docx` and `pdf`
 * shell out to `pandoc`, `google-chrome` and `gs` (render/shell.ts), which CI does not
 * install (issue #185 - that is option 1, declined). `build.ts` embeds the fingerprint
 * this produces in the manifest it writes; `detect.test.ts` recomputes it against the
 * current source tree and refuses to trust a built corpus whose hash disagrees, so a
 * stale build fails with an instruction to rebuild rather than a content assertion that
 * reads like a code regression.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const corpusDir = path.dirname(fileURLToPath(import.meta.url));

/** Every module whose content ends up, directly or through a shared helper, in a
 * disk-only source's rendered bytes or its `DocumentExpectation` gold: the renderer
 * itself, the process-shelling helpers it calls out through, the shared expectation
 * helpers (`relationsWithin` & co) both draw on, and the world content they render. */
const FINGERPRINT_SOURCES: Record<string, string[]> = {
	docx: ['render/docx.ts', 'render/shell.ts', 'types.ts', 'valdoria-reach.ts'],
	pdf: ['render/pdf.ts', 'render/shell.ts', 'types.ts', 'valdoria-reach.ts']
};
export function rendererFingerprint(source: string): string | undefined {
	const files = FINGERPRINT_SOURCES[source];
	if (!files) return undefined;
	const hash = createHash('sha256');
	for (const file of files) hash.update(readFileSync(path.join(corpusDir, file)));
	return hash.digest('hex');
}
