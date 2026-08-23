/**
 * Task `extract`, purpose `cheap`: the import loop, which is where the cheap model does
 * the most work and where a bad model costs the most.
 *
 * SPEC.md §6.7 is blunt about why this runs on the cheap tier: "bulk extraction runs on a
 * cheap model". An import is hundreds of documents and one call per step, so this single
 * task dominates the monthly cost column for the whole purpose. It is also the hardest
 * thing the cheap model is asked to do, because a document is somebody's unedited notes
 * and the model has to hold a tool loop together across several steps without losing the
 * thread.
 *
 * Scored per document against the corpus's own `DocumentExpectation`, which the renderers
 * derive from the world rather than from the extraction, so the gold answer does not know
 * what any model said. Three numbers, weighted by what actually hurts:
 *
 * - entity recall: the entities the document is about that the model proposed;
 * - entity precision, penalising the invented ones, which is what a GM has to reject one
 *   by one;
 * - relation recall, weighted lowest because a relation whose other endpoint is in another
 *   document is legitimately hard on the first pass, and the merge engine resolves
 *   endpoints across documents anyway.
 *
 * One document per source format rather than the whole export: the point is to compare
 * models on the same reading task, and paying for a full 30-document import twelve times
 * over would buy the same ranking at ten times the price. The full export is what
 * `src/e2e/import.ts` runs, once, with the model this bench picked.
 */
import { readFileSync } from 'node:fs';
import { manifestPath, archivePath, type CorpusManifest } from '../../corpus/build.js';
import { runImportDocuments } from '../../import-run.js';
import { slugify } from '../../corpus/slug.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';

/**
 * Which document of which export each case reads. One per format that the cheap model
 * actually drives, chosen as the most representative rather than the easiest: the Kanka
 * file with the most records, the Obsidian note with the most links, the World Anvil
 * article whose template does not map cleanly, the messy multi-entity generic note.
 * `pdf` and `docx` are absent on purpose - their text extraction is deterministic and the
 * interesting model question for a PDF is the scanned page, which is the `page` task under
 * the `multimodal` purpose.
 *
 * The two `onenote` cases were added by issue #329, and the reason they were missing is
 * worth keeping: `KNOWN_PLAYBOOK_IDS` used to carry no `onenote` entry, so an uploaded
 * export fell through `detectSource` to `generic`, `documentsForPlaybook('generic', ...)`
 * enumerated only `.md` and `.txt`, and a well-formed export imported nothing at all.
 * Issue #162 fixed that, and this comment kept saying otherwise for long enough that
 * `docs/models.md`'s 0.839 for `extract` was quoted as covering `onenote` when no case
 * here read a OneNote page.
 *
 * Both are subpages, because the parent/subpage relation is the one signal no other
 * playbook can see (`onenote.md`: a sibling `X.htm` beside a folder `X` means this page is
 * a subpage of `X`) and it is the part of that prompt a trim must not break. Each of them
 * expects exactly one relation, so this task's `relationRecall` for these two cases *is*
 * the folder-tree rule, scored on its own.
 *
 * One artefact to read them with: the playbook requires proposing a minimal entity for the
 * parent page, and the corpus gold for a subpage names only the subpage's own entity, so a
 * perfect run scores 1.0 recall, 0.5 precision and 1.0 relation recall, which is 0.825 and
 * not 1.0. That ceiling is the same on both sides of any comparison, so it does not
 * distort a before and after, and it is stated here rather than read as a defect.
 */
const CASES: Array<{ id: string; source: string; pick: (m: CorpusManifest) => string }> = [
	{
		id: 'obsidian-densest-note',
		source: 'obsidian',
		pick: (m) => mostRelations(m, (d) => d.sourcePath.endsWith('.md'))
	},
	{
		id: 'obsidian-non-entity-note',
		source: 'obsidian',
		// The precision case: a template or an inbox scratch file, which yields nothing and
		// which a careless model turns into three invented entries.
		pick: (m) => firstOrThrow(m, (d) => d.expectEntities.length === 0)
	},
	{
		id: 'kanka-characters',
		source: 'kanka',
		pick: (m) => firstOrThrow(m, (d) => d.sourcePath.endsWith('characters.json'))
	},
	{
		id: 'kanka-locations',
		source: 'kanka',
		pick: (m) => firstOrThrow(m, (d) => d.sourcePath.endsWith('locations.json'))
	},
	{
		id: 'world-anvil-article',
		source: 'world-anvil',
		pick: (m) => mostRelations(m, () => true)
	},
	{
		id: 'generic-messy-notes',
		source: 'generic',
		pick: (m) => mostEntities(m, () => true)
	},
	{
		id: 'generic-housekeeping',
		source: 'generic',
		pick: (m) => firstOrThrow(m, (d) => d.expectEntities.length === 0)
	},
	{
		id: 'onenote-first-subpage',
		source: 'onenote',
		pick: (m) => nthSubpage(m, 0)
	},
	{
		id: 'onenote-second-subpage',
		source: 'onenote',
		pick: (m) => nthSubpage(m, 1)
	}
];

function readManifest(source: string): CorpusManifest {
	return JSON.parse(readFileSync(manifestPath(source, 'v1'), 'utf8')) as CorpusManifest;
}

function firstOrThrow(
	manifest: CorpusManifest,
	predicate: (d: CorpusManifest['documents'][number]) => boolean
): string {
	const found = manifest.documents.find(predicate);
	if (!found) throw new Error(`${manifest.source} v1 has no document matching the extract case`);
	return found.sourcePath;
}

/** The nth document, by path, whose gold carries a `subpage of` relation: the folder-tree
 * rule of `onenote.md` and nothing else. Two of them, so one prompt change can be seen to
 * hold or break on more than a single page. */
function nthSubpage(manifest: CorpusManifest, index: number): string {
	const subpages = manifest.documents
		.filter((d) => d.expectRelations.some((r) => r.includes('|subpage of|')))
		.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
	const picked = subpages[index];
	if (!picked) {
		throw new Error(
			`${manifest.source} v1 has ${subpages.length} documents expecting a subpage-of relation, so index ${index} does not exist`
		);
	}
	return picked.sourcePath;
}

function mostEntities(
	manifest: CorpusManifest,
	predicate: (d: CorpusManifest['documents'][number]) => boolean
): string {
	const sorted = manifest.documents
		.filter(predicate)
		.filter((d) => d.expectEntities.length > 0)
		.sort(
			(a, b) =>
				b.expectEntities.length - a.expectEntities.length ||
				a.sourcePath.localeCompare(b.sourcePath)
		);
	const first = sorted[0];
	if (!first) throw new Error(`${manifest.source} v1 has no document with expected entities`);
	return first.sourcePath;
}

function mostRelations(
	manifest: CorpusManifest,
	predicate: (d: CorpusManifest['documents'][number]) => boolean
): string {
	const sorted = manifest.documents
		.filter(predicate)
		.filter((d) => d.expectEntities.length > 0)
		.sort(
			(a, b) =>
				b.expectRelations.length - a.expectRelations.length ||
				b.expectEntities.length - a.expectEntities.length ||
				a.sourcePath.localeCompare(b.sourcePath)
		);
	const first = sorted[0];
	if (!first) throw new Error(`${manifest.source} v1 has no document with expected relations`);
	return first.sourcePath;
}

export const extractTask: BenchTask = {
	id: 'extract',
	purpose: 'cheap',
	measures:
		'runs the real import loop over one document per source format and scores the entities and relations it proposed against the corpus gold',
	caseIds: () => CASES.map((c) => c.id),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const spec = CASES.find((c) => c.id === caseId);
		if (!spec) throw new Error(`no extract case ${caseId}`);
		const manifest = readManifest(spec.source);
		const sourcePath = spec.pick(manifest);
		const expectation = manifest.documents.find((d) => d.sourcePath === sourcePath);
		if (!expectation) throw new Error(`no expectation for ${sourcePath}`);

		const started = Date.now();
		const run = await runImportDocuments({
			db: ctx.db,
			archive: archivePath(spec.source, 'v1'),
			playbookId: manifest.playbook,
			documents: [{ id: 'doc-1', sourcePath }],
			jobId: `bench-extract-${caseId}-${ctx.slug.replace(/[^a-z0-9]+/gi, '-')}`
		});
		const latencyMs = Date.now() - started;

		// The proposals name entities the way a GM would write them, so they are matched to
		// gold slugs the way the merge engine does: on the slugified name, plus the aliases
		// the model was given. Anything that matches nothing is an invention, which is the
		// number that matters most here.
		const proposedSlugs = run.entities.map((e) => slugify(e.name));
		const expected = new Set(expectation.expectEntities);
		const found = new Set(proposedSlugs.filter((s) => expected.has(s)));
		const invented = proposedSlugs.filter((s) => !expected.has(s));

		const mustNot = new Set(expectation.mustNotPropose ?? []);
		const proposedForbidden = proposedSlugs.filter((s) => mustNot.has(s));

		const relationKeys = new Set(
			run.relations.map((r) => {
				const from = run.entities.find((e) => e.localId === r.fromLocalId);
				const to = run.entities.find((e) => e.localId === r.toLocalId);
				return `${from ? slugify(from.name) : r.fromLocalId}|${r.label}|${
					to ? slugify(to.name) : r.toLocalId
				}`;
			})
		);
		const relationsFound = expectation.expectRelations.filter((k) => relationKeys.has(k));

		const entityRecall =
			expectation.expectEntities.length === 0 ? 1 : found.size / expectation.expectEntities.length;
		const entityPrecision =
			proposedSlugs.length === 0
				? expectation.expectEntities.length === 0
					? 1
					: 0
				: found.size / proposedSlugs.length;
		const relationRecall =
			expectation.expectRelations.length === 0
				? 1
				: relationsFound.length / expectation.expectRelations.length;

		let score = 0.45 * entityRecall + 0.35 * entityPrecision + 0.2 * relationRecall;
		// A named `mustNotPropose` slug is a specific, predicted mistake, so it costs more
		// than a generic invention already counted in precision.
		if (proposedForbidden.length > 0) score *= 0.5;

		return {
			caseId,
			ok: run.status === 'finished' || run.status === 'stopped_at_ceiling',
			score,
			detail: {
				sourcePath,
				playbook: manifest.playbook,
				status: run.status,
				statusDetail: run.detail,
				steps: run.steps,
				expectedEntities: expectation.expectEntities,
				proposedEntities: run.entities.map((e) => ({
					name: e.name,
					slug: slugify(e.name),
					type: e.type,
					language: e.language,
					summary: e.summary.slice(0, 200),
					evidenceSpan: e.evidenceSpan
				})),
				invented,
				proposedForbidden,
				expectedRelations: expectation.expectRelations,
				proposedRelations: [...relationKeys],
				relationsFound,
				entityRecall,
				entityPrecision,
				relationRecall
			},
			latencyMs,
			inputTokens: run.inputTokens,
			outputTokens: run.outputTokens,
			// SPEC.md §11.5 says every call records itself in `model_call`, and issue #133
			// records that an import does not. So this cost comes from the driver's own
			// `usage` events rather than from the table, which is the honest source until
			// that issue is fixed.
			costEur: run.costEur
		};
	}
};
