/**
 * Issue #592's fidelity question, answered by comparison rather than by a second live
 * sweep: **is what a model reads from a `.mht` the same thing it reads from the folder
 * tree?** That matters because `docs/models.md`'s 0.839 for `cheap` on `extract` was
 * measured against the folder-tree shape, and if the two shapes hand the model the same
 * text then that number carries over and re-measuring it would only buy noise.
 *
 * So the two fixtures describe **the same three pages with byte-identical prose**:
 * `test/fixtures/onenote/export/` is the folder tree the third-party tool produces, and
 * `test/fixtures/onenote-formats/section.mht` is OneNote's own envelope holding the same
 * words. The assertions below read both through the real `ArchiveSourceReader` the job
 * runner uses, put each page's `source_read` result through the same
 * `stripHtmlPresentationNoise` the reader already applies, reduce both to plain text, and
 * require them to match.
 *
 * What that does and does not license, stated so nobody over-reads it. It licenses the
 * claim that the *extraction* input is equivalent, page for page. It does not license any
 * claim about the parent/subpage rule, which reads the folder tree and has nothing to read
 * in a `.mht` (see `mhtml.ts`: the export carries no hierarchy). The folder tree therefore
 * remains strictly better for a notebook whose structure means something, and the tests
 * below say which of the two carries the parent and which does not.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { ArchiveSourceReader } from './archive.js';

const FORMATS = fileURLToPath(new URL('../test/fixtures/onenote-formats/', import.meta.url));
const TREE = fileURLToPath(new URL('../test/fixtures/onenote/export/', import.meta.url));

/** The folder-tree fixture, zipped in memory exactly as an upload of it would arrive. */
function treeReader(): ArchiveSourceReader {
	const files: Record<string, Uint8Array> = {};
	const walk = (directory: string, prefix: string) => {
		for (const name of readdirSync(directory)) {
			const full = `${directory}/${name}`;
			if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
			else files[`${prefix}${name}`] = new Uint8Array(readFileSync(full));
		}
	};
	walk(TREE, '');
	return ArchiveSourceReader.openUpload(zipSync(files), 'export.zip');
}

/** Every `<p>` element's text, in order, with tags and whitespace gone. Not a general
 * HTML decoder: it only has to make two renderings of the same three paragraphs
 * comparable. */
function paragraphs(html: string): string[] {
	return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)]
		.map((match) =>
			match[1]!
				.replace(/<[^>]*>/g, ' ')
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
				.replace(/\s+/g, ' ')
				.trim()
		)
		.filter((text) => text.length > 0);
}

const PAGES = ['Warden Iset Nour', 'The Sunken Archive', 'Flooded Stacks'] as const;

describe('a .mht and a folder tree hand a model the same text (issue #592)', () => {
	it('both shapes enumerate the same three pages', async () => {
		const envelope = ArchiveSourceReader.openUpload(
			new Uint8Array(readFileSync(`${FORMATS}section.mht`)),
			'Handouts.mht'
		);
		const fromEnvelope = (await envelope.list('Handouts'))
			.filter((e) => e.path.endsWith('.htm'))
			.map((e) => e.path.replace(/^Handouts\/|\.htm$/g, ''));
		expect(fromEnvelope.sort()).toEqual([...PAGES].sort());
	});

	for (const page of PAGES) {
		it(`"${page}" reads identically from both`, async () => {
			const envelope = ArchiveSourceReader.openUpload(
				new Uint8Array(readFileSync(`${FORMATS}section.mht`)),
				'Handouts.mht'
			);
			const fromEnvelope = paragraphs((await envelope.read(`Handouts/${page}.htm`)).content);

			const tree = treeReader();
			const treePath = (await walkPaths(tree)).find((p) => p.endsWith(`/${page}.htm`))!;
			const fromTree = paragraphs((await tree.read(treePath)).content);

			// Every paragraph of prose the folder tree carries is in the envelope's page, word
			// for word. The envelope has three paragraphs the tree does not, and they are
			// content OneNote puts on the page rather than a difference in the prose: the
			// page's own title, its creation date and its creation time.
			expect(fromTree.length).toBeGreaterThan(0);
			for (const paragraph of fromTree) {
				expect(fromEnvelope).toContain(paragraph);
			}
			expect(fromEnvelope[0]).toBe(page);

			// And no other page's prose leaked into this one.
			const others = PAGES.filter((p) => p !== page);
			for (const other of others) {
				const otherTreePath = (await walkPaths(tree)).find((p) => p.endsWith(`/${other}.htm`))!;
				for (const paragraph of paragraphs((await tree.read(otherTreePath)).content)) {
					if (paragraph === other) continue;
					expect(fromEnvelope).not.toContain(paragraph);
				}
			}
		});
	}

	it('the folder tree carries the parent and the envelope does not, which is the whole difference', async () => {
		// "Flooded Stacks" sits in a folder named after "The Sunken Archive" in the tree, and
		// that folder is what `onenote.md`'s parent/subpage rule reads. The envelope has no
		// equivalent, so its pages are siblings. Pinned as behaviour rather than left to be
		// re-guessed: this is the one thing the `.mht` genuinely loses.
		const tree = treeReader();
		const treePaths = await walkPaths(tree);
		expect(treePaths.some((p) => p.includes('/The Sunken Archive/Flooded Stacks.htm'))).toBe(true);

		const envelope = ArchiveSourceReader.openUpload(
			new Uint8Array(readFileSync(`${FORMATS}section.mht`)),
			'Handouts.mht'
		);
		const envelopePaths = (await walkPaths(envelope)).filter((p) => p.endsWith('.htm'));
		expect(envelopePaths.every((p) => p.split('/').length === 2)).toBe(true);
	});

	it('an embedded image survives both, beside its own page', async () => {
		const envelope = ArchiveSourceReader.openUpload(
			new Uint8Array(readFileSync(`${FORMATS}section.mht`)),
			'Handouts.mht'
		);
		const asset = await envelope.readBinary('Handouts/The Sunken Archive_files/image001.png');
		expect(asset.mimeType).toBe('image/png');

		const tree = treeReader();
		const treeAsset = await tree.readBinary(
			'Ashenport Campaign/Handouts/The Sunken Archive_files/archive-map.png'
		);
		expect(treeAsset.mimeType).toBe('image/png');
	});
});

async function walkPaths(reader: ArchiveSourceReader, prefix = ''): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await reader.list(prefix)) {
		if (entry.kind === 'file') out.push(entry.path);
		else out.push(...(await walkPaths(reader, entry.path)));
	}
	return out;
}
