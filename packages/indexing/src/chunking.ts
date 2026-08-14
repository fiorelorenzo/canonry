/**
 * Token-budgeted chunking with a section breadcrumb (SPEC.md §7/§11.3). Splits a wiki
 * page's cleaned text on its `== Heading ==` markers (any nesting level), then packs each
 * section's paragraphs into chunks that stay under a token budget, carrying a breadcrumb
 * built from the heading stack (`Page Title > Heading > Subheading`) the same way the
 * eval corpus's `chunkEntity` does for entity bodies.
 *
 * No tokenizer dependency in this monorepo, so token count is estimated at ~4 characters
 * per token (OpenAI's own rule of thumb for English prose) - close enough to keep chunks
 * inside a model's context window, which is the only thing the budget has to guarantee.
 */
import { wikitextToPlainText } from './wikitext.js';

const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export interface WikiChunk {
	/** 0-based position of this chunk within the page, stable across re-indexing runs as
	 * long as the page's section structure does not change - used to build a
	 * deterministic point id. */
	index: number;
	breadcrumb: string;
	text: string;
}

interface Section {
	breadcrumb: string;
	body: string;
}

const HEADING_PATTERN = /^(={2,6})\s*(.+?)\s*\1\s*$/;

function splitIntoSections(pageTitle: string, plainText: string): Section[] {
	const lines = plainText.split('\n');
	const sections: Section[] = [];
	// Heading stack indexed by level (2 through 6); level 1 is the page title itself.
	const stack: string[] = [pageTitle];
	let currentBreadcrumb = pageTitle;
	let currentLines: string[] = [];

	const flush = () => {
		const body = currentLines.join('\n').trim();
		if (body.length > 0) sections.push({ breadcrumb: currentBreadcrumb, body });
		currentLines = [];
	};

	for (const line of lines) {
		const match = HEADING_PATTERN.exec(line);
		if (!match) {
			currentLines.push(line);
			continue;
		}
		flush();
		const level = match[1]!.length;
		const heading = match[2]!;
		stack.length = level - 1; // levels start at 2, so level 2 keeps only the page title
		stack.push(heading);
		currentBreadcrumb = stack.join(' > ');
	}
	flush();
	return sections;
}

interface SplitLevel {
	pattern: RegExp;
	joiner: string;
}

/** Cascading granularity: whole paragraphs first, then sentences, then bare words as a
 * last resort for prose with no sentence-ending punctuation at all. */
const SPLIT_LEVELS: SplitLevel[] = [
	{ pattern: /\n\n+/, joiner: '\n\n' },
	{ pattern: /(?<=[.!?])\s+/, joiner: ' ' },
	{ pattern: /\s+/, joiner: ' ' }
];

/** Greedily packs `text` into chunks no larger than `tokenBudget`, splitting at the
 * coarsest level that yields more than one unit and recursing one level finer whenever a
 * single unit still does not fit. Bottoms out at single words: a word longer than the
 * budget on its own is returned whole rather than broken mid-word. */
function packUnits(text: string, tokenBudget: number, levelIndex: number): string[] {
	if (estimateTokens(text) <= tokenBudget) return [text];
	const level = SPLIT_LEVELS[levelIndex];
	if (!level) return [text];

	const units = text.split(level.pattern).filter((u) => u.trim().length > 0);
	if (units.length <= 1) return packUnits(text, tokenBudget, levelIndex + 1);

	const chunks: string[] = [];
	let current = '';
	for (const unit of units) {
		const candidate = current.length > 0 ? `${current}${level.joiner}${unit}` : unit;
		if (estimateTokens(candidate) <= tokenBudget) {
			current = candidate;
			continue;
		}
		if (current.length > 0) chunks.push(current);
		if (estimateTokens(unit) <= tokenBudget) {
			current = unit;
		} else {
			chunks.push(...packUnits(unit, tokenBudget, levelIndex + 1));
			current = '';
		}
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

function packSection(body: string, tokenBudget: number): string[] {
	return packUnits(body, tokenBudget, 0)
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.length > 0);
}

export const DEFAULT_CHUNK_TOKEN_BUDGET = 400;

export interface ChunkWikiPageOptions {
	tokenBudget?: number;
}

export function chunkWikiPage(
	pageTitle: string,
	wikitext: string,
	options: ChunkWikiPageOptions = {}
): WikiChunk[] {
	const tokenBudget = options.tokenBudget ?? DEFAULT_CHUNK_TOKEN_BUDGET;
	const plainText = wikitextToPlainText(wikitext);
	const sections = splitIntoSections(pageTitle, plainText);

	const chunks: WikiChunk[] = [];
	for (const section of sections) {
		for (const text of packSection(section.body, tokenBudget)) {
			chunks.push({ index: chunks.length, breadcrumb: section.breadcrumb, text });
		}
	}
	return chunks;
}
