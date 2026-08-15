/**
 * Before a run that takes an hour and spends real money, ask every candidate one trivial
 * question and check four things: the gateway routes the slug at all, the model answers,
 * it can produce a structured object, and it can hold a tool call. A slug that was
 * decommissioned since the catalogue was written fails here in ten seconds rather than in
 * the middle of task three.
 *
 * Run it with `pnpm --filter @canonry/bench models -- --preflight`.
 */
import { generateObject, generateText, tool } from 'ai';
import { z } from 'zod';
import { benchModelFactory } from './factory.js';
import { CANDIDATES, JUDGES, splitSlug, type BenchPurpose } from './candidates.js';
import { findModel, loadCatalogue } from './catalogue.js';
import { isTransient } from './runner.js';

export interface PreflightRow {
	slug: string;
	purposes: BenchPurpose[];
	reachable: boolean;
	structuredOutput: boolean;
	toolCall: boolean;
	vision: boolean | null;
	latencyMs: number;
	note: string;
}

const shapeSchema = z.object({
	city: z.string(),
	sworn: z.number().int()
});

export async function preflight(slugs: string[]): Promise<PreflightRow[]> {
	const catalogue = await loadCatalogue();
	const rows: PreflightRow[] = [];

	for (const slug of slugs) {
		const { provider, modelId } = splitSlug(slug);
		const model = benchModelFactory({ purpose: 'cheap', provider, modelId, params: {} });
		const purposes = (Object.keys(CANDIDATES) as BenchPurpose[]).filter((p) =>
			CANDIDATES[p].some((c) => c.slug === slug)
		);
		const row: PreflightRow = {
			slug,
			purposes,
			reachable: false,
			structuredOutput: false,
			toolCall: false,
			vision: null,
			latencyMs: 0,
			note: ''
		};
		try {
			row.vision = findModel(catalogue, slug).inputModalities.includes('image');
		} catch (error) {
			row.note = error instanceof Error ? error.message : String(error);
		}

		const started = Date.now();
		try {
			const text = await generateText({
				model,
				prompt: 'Reply with the single word: ready',
				maxOutputTokens: 2048
			});
			row.reachable = text.text.trim().length > 0;
		} catch (error) {
			row.note =
				`${row.note} text: ${error instanceof Error ? error.message : String(error)}`.trim();
			row.latencyMs = Date.now() - started;
			rows.push(row);
			continue;
		}
		row.latencyMs = Date.now() - started;

		try {
			const object = await generateObject({
				model,
				schema: shapeSchema,
				prompt:
					'The free port of Valdoria keeps a watch of three hundred and forty sworn. Fill the schema.'
			});
			row.structuredOutput = object.object.city.length > 0;
		} catch (error) {
			row.note =
				`${row.note} object: ${error instanceof Error ? error.message : String(error)}`.trim();
		}

		try {
			const result = await generateText({
				model,
				prompt: 'Call source_list with path "" and then stop.',
				tools: {
					source_list: tool({
						description: 'List files in the export',
						inputSchema: z.object({ path: z.string() }),
						execute: async () => ({ entries: ['characters.json'] })
					})
				},
				maxOutputTokens: 2048
			});
			row.toolCall = result.steps.some((step) => step.toolCalls.length > 0);
		} catch (error) {
			row.note =
				`${row.note} tool: ${error instanceof Error ? error.message : String(error)}`.trim();
		}

		if (row.note.length > 0 && isTransient(row.note)) row.note = `${row.note} (transient?)`;
		rows.push(row);
	}

	return rows;
}

export function allBenchSlugs(): string[] {
	const seen = new Set<string>();
	for (const purpose of Object.keys(CANDIDATES) as BenchPurpose[]) {
		for (const candidate of CANDIDATES[purpose]) seen.add(candidate.slug);
	}
	for (const judge of JUDGES) seen.add(judge);
	return [...seen].sort();
}
