import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./outcome-note.ts', import.meta.url)), 'utf8');

describe('outcome-note.ts stays a leaf module (issue #467)', () => {
	it('imports nothing, so @canonry/import/outcome-note never pulls Buffer into a browser bundle', () => {
		// apps/web's client components used to reach parseOutcomeNote through @canonry/import's
		// barrel, whose only export was '.', so the browser bundle pulled in job-runner.ts and
		// everything it imports - archive.ts, pdf.ts, docx.ts, media-store.ts - and their Node
		// Buffer use with it. SSR has a real Buffer, so nothing caught it until hydration threw
		// "ReferenceError: Buffer is not defined" and SvelteKit's client error boundary replaced
		// the page. This file is the fix's leaf: it must never import anything, Node-only or
		// not, so it cannot regrow that dependency without failing here first.
		expect(SOURCE).not.toMatch(/^\s*import\b/m);
	});
});
