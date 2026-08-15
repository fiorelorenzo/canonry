/**
 * Task `page`, purpose `multimodal`: the one job in the whole product that needs a model
 * that can see.
 *
 * SPEC.md §6.3 describes `page_image` as rendering one page of a PDF and handing it to a
 * multimodal model "so a scanned page is simply looked at. Local and deterministic: no OCR
 * provider, no per-page fee, no third party". The corpus's `players-handout.pdf` carries
 * eight pages, five with a text layer and three that are scans with no extractable text at
 * all: a photostat of a typed sheet, a second-generation photocopy of a typed sheet, and a
 * handwritten note, each degraded a different way. One clean scan only tells you whether a
 * model can read a clean scan; three, each hard in a different way, tell you whether it can
 * read what a GM's scanner actually produces. Because the bench printed every one of those
 * pages itself, the ground truth is known to the character (`SCANNED_PAGES`), which makes
 * this the only task here that can be scored without any judgement at all.
 *
 * Two numbers, and the second matters more than the first. Character accuracy says whether
 * the model can read the page. Entity recall says whether reading it produced the thing
 * the import actually needs, which is the entities on it. A model that transcribes
 * beautifully and then names nothing is no use to the loop.
 *
 * The page is fed through `renderPdfPage`, the product's own renderer, rather than through
 * a PNG the bench kept on the side. A model that reads a crisp original and fails on what
 * pdfjs actually produces would be a model that fails in production.
 */
import { readFileSync } from 'node:fs';
import { generateObject } from 'ai';
import { z } from 'zod';
import { ArchiveSourceReader, DEFAULT_ARCHIVE_LIMITS } from '@canonry/import';
import { resolveModel } from '@canonry/ai';
import { archivePath } from '../../corpus/build.js';
import { SCANNED_PAGES } from '../../corpus/render/pdf.js';
import { slugify } from '../../corpus/slug.js';
import { benchModelFactory } from '../factory.js';
import { withRetry } from '../runner.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';

const readingSchema = z.object({
	text: z.string().describe('everything legible on the page, transcribed as written'),
	entities: z
		.array(z.object({ name: z.string(), type: z.string() }))
		.describe('the people, places, factions, items and events the page names')
});

/**
 * Levenshtein distance over the two strings, normalised to a 0-to-1 similarity. Written
 * out rather than pulled in, because the alternative is an npm dependency in a package
 * that has deliberately kept to the ones the product already uses, and this is thirty
 * lines. Both strings are collapsed to single spaces and lowercased first: a scan read
 * back with different line breaks is a correct reading, and scoring it down for whitespace
 * would measure the prompt's formatting instructions instead of the model's eyes.
 */
function characterAccuracy(expected: string, actual: string): number {
	const a = expected.toLowerCase().replace(/\s+/g, ' ').trim();
	const b = actual.toLowerCase().replace(/\s+/g, ' ').trim();
	if (a.length === 0) return b.length === 0 ? 1 : 0;

	let previous = new Array<number>(b.length + 1);
	let current = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) previous[j] = j;

	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
			current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution);
		}
		[previous, current] = [current, previous];
	}

	const distance = previous[b.length]!;
	return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

export const pageTask: BenchTask = {
	id: 'page',
	purpose: 'multimodal',
	measures:
		'reads a scanned page with no text layer, scored on character accuracy against the page the corpus printed and on the entities it found',
	caseIds: () => SCANNED_PAGES.map((p) => p.id),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const page = SCANNED_PAGES.find((p) => p.id === caseId);
		if (!page) throw new Error(`no scanned page ${caseId}`);

		const reader = ArchiveSourceReader.open(
			readFileSync(archivePath('pdf', 'v1')),
			DEFAULT_ARCHIVE_LIMITS
		);
		const entries = await reader.list('');
		const pdfEntry = entries.find(
			(e) => e.kind === 'file' && e.path.toLowerCase().endsWith('.pdf')
		);
		if (!pdfEntry) throw new Error('the pdf corpus holds no pdf');

		const rendered = await reader.renderPage(pdfEntry.path, page.pageNumber);
		const resolved = await resolveModel(ctx.db, 'multimodal');

		const started = Date.now();
		const result = await withRetry(() =>
			generateObject({
				model: benchModelFactory(resolved),
				schema: readingSchema,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'text',
								text:
									'This is one page of a tabletop RPG campaign export, scanned rather than ' +
									'typed, so it carries no text layer. Transcribe everything legible on it, ' +
									'exactly as written, and list the people, places, factions, items and ' +
									'events it names. Do not add anything the page does not say.'
							},
							{
								type: 'file',
								data: { type: 'data', data: rendered.base64 },
								mediaType: rendered.mimeType
							}
						]
					}
				]
			})
		);
		const latencyMs = Date.now() - started;

		const accuracy = characterAccuracy(page.text, result.object.text);
		const readSlugs = new Set(result.object.entities.map((e) => slugify(e.name)));
		const expected = page.entities;
		const found = expected.filter((slug) => readSlugs.has(slug));
		const invented = [...readSlugs].filter((slug) => !expected.includes(slug));

		const entityRecall = expected.length === 0 ? 1 : found.length / expected.length;
		const entityPrecision = readSlugs.size === 0 ? 0 : found.length / readSlugs.size;
		const score = 0.35 * accuracy + 0.45 * entityRecall + 0.2 * entityPrecision;

		// The import's own cost accounting does not cover this call (issue #133), so the
		// price comes from the resolved model's params, which is the same arithmetic
		// `computeCost` does and the same numbers `model_config` holds.
		const costEur =
			((result.usage.inputTokens ?? 0) * (resolved.params.eurPerInputMTok ?? 0)) / 1e6 +
			((result.usage.outputTokens ?? 0) * (resolved.params.eurPerOutputMTok ?? 0)) / 1e6;

		return {
			caseId: page.id,
			ok: result.object.text.trim().length > 0,
			score,
			detail: {
				pageNumber: page.pageNumber,
				kind: page.kind,
				imageBytes: Math.round((rendered.base64.length * 3) / 4),
				accuracy,
				entityRecall,
				entityPrecision,
				expectedEntities: expected,
				readEntities: result.object.entities,
				invented,
				transcription: result.object.text
			},
			latencyMs,
			inputTokens: result.usage.inputTokens ?? 0,
			outputTokens: result.usage.outputTokens ?? 0,
			costEur
		};
	}
};
