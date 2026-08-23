/**
 * Issue #615, the pairing that made it visible: #612 rewrote the OneNote guide to lead
 * with `File > Export` and `.one`/`.onepkg`, and the file picker still offered the list it
 * had before those readers existed, so the guide told a GM to produce a file the picker
 * then appeared to refuse. Nothing connected the two, which is why both were internally
 * consistent and wrong together.
 *
 * `packages/import`'s own `upload-format.test.ts` guards the other half, the picker against
 * the readers. This is the half only `apps/web` can see: every extension a guide names as
 * something to hand us has to be one the picker offers, or one the product refuses on
 * purpose and says so. It scans the guide data rather than a hand-kept list, so a paragraph
 * added tomorrow that names a new format is checked without anyone remembering to come
 * here.
 */
import { describe, expect, it } from 'vitest';
import { OFFERED_UPLOAD_EXTENSIONS, WITHHELD_UPLOAD_EXTENSIONS } from '@canonry/import';
import { IMPORT_GUIDES } from '$lib/components/docs/importGuides.js';

/** Tokens that look like an extension and are not one. `.obsidian` is a folder inside a
 * vault, which is what the Obsidian guide keys detection on, and it can never be handed to
 * the picker on its own. Anything else that turns up here is a real finding, not a case to
 * add to this list without a reason beside it. */
const NOT_AN_EXTENSION = ['.obsidian'];

/** Every word of every guide, flattened. Lists are included: an instruction is as likely
 * to name a format in a numbered step as in a paragraph. */
function guideText(slug: string): string {
	const guide = IMPORT_GUIDES.find((candidate) => candidate.slug === slug);
	if (!guide) throw new Error(`there is no import guide called ${slug}`);
	return [
		guide.summary,
		...guide.sections.flatMap((section) => [
			section.heading,
			...section.blocks.flatMap((block) => (block.kind === 'list' ? block.items : [block.text]))
		])
	].join('\n');
}

function extensionsNamedIn(text: string): string[] {
	const found = new Set(text.match(/\.[a-z][a-z0-9]{1,8}\b/g) ?? []);
	return [...found].filter((extension) => !NOT_AN_EXTENSION.includes(extension));
}

describe('the import guides and the file picker name the same formats (issue #615)', () => {
	for (const guide of IMPORT_GUIDES) {
		it(`${guide.slug}: every extension it names is either offered or refused on purpose`, () => {
			const unaccounted = extensionsNamedIn(guideText(guide.slug)).filter(
				(extension) =>
					!(extension in OFFERED_UPLOAD_EXTENSIONS) && !(extension in WITHHELD_UPLOAD_EXTENSIONS)
			);
			expect(unaccounted).toEqual([]);
		});
	}

	it('the OneNote guide leads with the two exports the picker offers (issues #603, #612)', () => {
		// The specific pairing that broke: these two are the whole reason #612 exists, and a
		// picker that does not offer them makes the advice unfollowable.
		const text = guideText('onenote');
		for (const extension of ['.one', '.onepkg']) {
			expect(text).toContain(extension);
			expect(OFFERED_UPLOAD_EXTENSIONS[extension]).toBeDefined();
		}
	});

	it('the OneNote guide says .xps is refused, and the picker does not offer it (issue #601)', () => {
		// The one format where guide and picker agree by staying apart: the guide names it in
		// order to explain the refusal, so the token appears without being an offer.
		expect(guideText('onenote')).toContain('.xps');
		expect(WITHHELD_UPLOAD_EXTENSIONS['.xps']).toBe('xps');
		expect(OFFERED_UPLOAD_EXTENSIONS['.xps']).toBeUndefined();
	});

	it('no guide tells a GM to upload a folder, which this input cannot take', () => {
		// SPEC §6.6 calls an Obsidian vault "folder or zip" and an exported OneNote page tree
		// a folder, and both are true of the source. What an `<input type="file">` accepts is
		// one file, so a guide that says to point Canonry at a folder is describing an upload
		// nobody can perform. Both said exactly that until this issue.
		for (const guide of IMPORT_GUIDES) {
			expect(guideText(guide.slug).toLowerCase()).not.toMatch(
				/(point canonry at|upload) the folder\b/
			);
		}
	});
});
