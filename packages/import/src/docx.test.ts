import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractDocxText } from './docx.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../test/fixtures/docx/', import.meta.url));

/**
 * `heading-levels.docx` (checked in for this issue) is a real DOCX built with pandoc
 * from Markdown with two heading levels, a bullet list and a table, so it exercises
 * every structural element `playbooks/docx.md` documents. `heading-levels.expected-text.txt`
 * is this module's own output on that exact file, generated once and reviewed, then
 * pinned as a regression fixture - not hand-typed and not another tool's output, since
 * `docx.md`'s convention (single-space `- ` bullets, no pipe-table header separator) is
 * this module's own to define, not a third-party converter's.
 */
async function loadDocx(name: string): Promise<Uint8Array> {
	return new Uint8Array(await readFile(`${FIXTURE_ROOT}${name}`));
}

describe('extractDocxText (issue #39, SPEC.md §6.6)', () => {
	it('matches the pinned regression fixture exactly, byte for byte', async () => {
		const bytes = await loadDocx('heading-levels.docx');
		const expected = await readFile(`${FIXTURE_ROOT}heading-levels.expected-text.txt`, 'utf8');
		const { text } = await extractDocxText(bytes);
		expect(text).toBe(expected);
	});

	it('prefixes headings by level: # for Heading 1, ## for Heading 2', async () => {
		const bytes = await loadDocx('heading-levels.docx');
		const { text } = await extractDocxText(bytes);
		expect(text).toContain('# Camp Ashgrove');
		expect(text).toContain('## Personnel');
		expect(text).toContain('## Supplies');
	});

	it('renders list items as - -prefixed lines', async () => {
		const bytes = await loadDocx('heading-levels.docx');
		const { text } = await extractDocxText(bytes);
		expect(text).toContain('- Quartermaster Beren Voss keeps the ledgers');
		expect(text).toContain('- Two hired scouts watch the northern approach');
	});

	it('flattens table rows to |-separated cells', async () => {
		const bytes = await loadDocx('heading-levels.docx');
		const { text } = await extractDocxText(bytes);
		expect(text).toContain('| Item | Quantity |');
		expect(text).toContain('| Dried ration | 40 |');
	});

	it('keeps ordinary paragraph text as plain text with no markup', async () => {
		const bytes = await loadDocx('heading-levels.docx');
		const { text } = await extractDocxText(bytes);
		expect(text).toContain('A waystation on the old caravan road');
		expect(text).toContain('Beren Voss trusts the scouts with the gate key');
	});

	it('drops visual styling (bold/italic markup, font runs) while keeping the words', async () => {
		// notes.docx (Playbooks' own fixture, issue #46) has bold/italic runs inside its
		// prose; this only asserts on words, never on *, **, <strong> or any other markup
		// leaking through, which is the actual "visual styling dropped" contract.
		const bytes = await loadDocx('notes.docx');
		const { text } = await extractDocxText(bytes);
		expect(text).not.toMatch(/[*_<>]/);
		expect(text).toContain('# Warden Iset Nour');
		expect(text).toContain('Keeper of the eastern gate');
	});
});
