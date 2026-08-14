/**
 * The LLM extraction pass, one call per chunk (SPEC.md §7/§11.3): "an LLM pass per chunk
 * extracting sectionSummary / questionsThisExcerptCanAnswer / excerptKeywords". Injected
 * as a `ChunkExtractor` (the same seam idiom as packages/eval's `Retriever` and
 * packages/import's `ModelSelector`), so the pipeline never depends on which
 * implementation produced the metadata.
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import type { Db } from '@canonry/db';
import { withUsage } from '@canonry/ai';
import type { ResolvedExtractionModel } from './models.js';

export interface ChunkMetadata {
	sectionSummary: string;
	questionsThisExcerptCanAnswer: string[];
	excerptKeywords: string[];
}

export interface ExtractionInput {
	pageTitle: string;
	breadcrumb: string;
	text: string;
}

export type ChunkExtractor = (input: ExtractionInput) => Promise<ChunkMetadata>;

const EXTRACTION_SCHEMA = z.object({
	sectionSummary: z.string().describe('One or two sentences summarising this excerpt.'),
	questionsThisExcerptCanAnswer: z
		.array(z.string())
		.describe('Questions a reader could answer using only this excerpt.'),
	excerptKeywords: z.array(z.string()).describe('Distinctive terms this excerpt is about.')
});

export interface GatewayExtractorDeps {
	db: Db;
	model: ResolvedExtractionModel;
	/** Whoever triggered this indexing run - attributed on every `model_call` row
	 * (SPEC.md §11.5), since pre-indexed content has no single "owning" GM to charge. */
	userId: string;
	universeId: string | null;
}

/** Production implementation: routes through `@canonry/ai`'s `withUsage` (agent
 * `'indexing'`, operation `'index.wiki.extract'`, priced at zero credits like every
 * reading-adjacent operation - see `operation_price`) so every extraction call is
 * attributed and cost-tracked the same way any other model call in this product is. */
export function createGatewayExtractor(deps: GatewayExtractorDeps): ChunkExtractor {
	return async (input) => {
		const result = await withUsage(
			deps.db,
			deps.model,
			{
				userId: deps.userId,
				universeId: deps.universeId,
				agent: 'indexing',
				operation: 'index.wiki.extract'
			},
			() =>
				generateObject({
					model: deps.model.model,
					schema: EXTRACTION_SCHEMA,
					system:
						'You extract structured retrieval metadata from one excerpt of a wiki page. Be concrete and grounded only in the excerpt given.',
					prompt: `Page section: ${input.breadcrumb}\n\nExcerpt:\n${input.text}`
				}),
			{
				extractUsage: (result) => ({
					inputTokens: result.usage.inputTokens ?? 0,
					outputTokens: result.usage.outputTokens ?? 0
				})
			}
		);
		return result.object;
	};
}

const STOPWORDS = new Set([
	'the',
	'a',
	'an',
	'of',
	'and',
	'or',
	'to',
	'in',
	'on',
	'at',
	'for',
	'with',
	'is',
	'are',
	'was',
	'were',
	'it',
	'its',
	'this',
	'that',
	'as',
	'by',
	'from'
]);

/** A network-free, deterministic default extractor: no LLM call, so it needs no gateway
 * credentials and produces the same output for the same input every time. Used where a
 * real model call is not available (this package's own tests, the retrieval harness
 * wiring) - `createGatewayExtractor` above is what a real indexing run wires in instead.
 * Not a stand-in for extraction quality, only for having *something real* to chunk,
 * embed and query against without a network dependency. */
export const heuristicExtractor: ChunkExtractor = async (input) => {
	const words = input.text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 3 && !STOPWORDS.has(word));

	const frequency = new Map<string, number>();
	for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
	const excerptKeywords = [...frequency.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([word]) => word);

	const firstSentence = /^[^.!?]*[.!?]/.exec(input.text.trim())?.[0]?.trim();
	const sectionSummary = firstSentence ?? input.text.trim().slice(0, 160);

	return {
		sectionSummary,
		questionsThisExcerptCanAnswer: [`What does ${input.breadcrumb} say about this?`],
		excerptKeywords
	};
};
