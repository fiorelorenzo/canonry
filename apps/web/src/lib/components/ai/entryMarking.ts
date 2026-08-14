/**
 * Wires C1 = B's marking (`aiMarking.ts`, `AiMarkedParagraph.svelte`) into a real entry
 * body (#106): which paragraphs does a pending proposal's semantic diff touch, so the
 * read view can mark them without ever showing the proposed wording itself (that lives
 * in the diff, #51, C4).
 *
 * The block splitting here mirrors `packages/copilot`'s `diff.ts` (`splitIntoSentences`)
 * deliberately, not by importing it: that split is private to `diff.ts` (only the flat
 * sentence list is exported) and a proposal's `previousStatement` is one of its outputs,
 * so this file has to produce the exact same sentence strings to find them again inside
 * the entity's current body. Duplicated on purpose rather than exported from
 * `packages/copilot` for a UI-only concern: two three-line regexes staying in sync is
 * cheaper than a cross-package dependency for a read-view detail, and both are covered by
 * their own tests, so drift shows up immediately rather than silently.
 */
import { stripMentionSyntax } from '$lib/markdown';
import type { ParagraphSegment } from './aiMarking';

const HEADING_RE = /^#{1,6}\s+/;
// Splits after sentence-ending punctuation, only where the next sentence plausibly starts
// (capital letter, digit, or a `[[wikilink]]`) - see packages/copilot/src/diff.ts's own
// comment on the identical regex for why (keeps "Mr. Smith" from splitting mid-name).
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9[])/;

function splitParagraphIntoSentences(paragraph: string): string[] {
	return paragraph
		.split(SENTENCE_SPLIT_RE)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

export interface EntryBlock {
	/** Raw source text exactly as it appears in the body (lines joined with `\n`) - passed
	 * through the real markdown renderer untouched whenever nothing in it is marked, so a
	 * list or a blockquote the marking does not touch keeps its full formatting. */
	raw: string;
	/** This block's sentences, normalised the way `packages/copilot`'s `semanticDiff`
	 * normalises them (lines trimmed and joined with a single space, then sentence-split) -
	 * what a proposal's `previousStatement` is matched against. A heading block is one
	 * "sentence": the heading line itself, matching how `diff.ts` treats a heading as its
	 * own fact-sized unit. */
	sentences: string[];
}

/** Splits a markdown body into the same blocks `packages/copilot`'s `diff.ts` reads: one
 * per heading line, one per run of non-heading lines between blank lines. */
export function splitBodyIntoBlocks(body: string): EntryBlock[] {
	const blocks: EntryBlock[] = [];
	let rawLines: string[] = [];

	const flush = (): void => {
		if (rawLines.length === 0) return;
		const raw = rawLines.join('\n');
		const normalized = rawLines
			.map((line) => line.trim())
			.join(' ')
			.trim();
		blocks.push({ raw, sentences: normalized ? splitParagraphIntoSentences(normalized) : [] });
		rawLines = [];
	};

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '') {
			flush();
			continue;
		}
		if (HEADING_RE.test(line)) {
			flush();
			blocks.push({ raw: line, sentences: [line] });
			continue;
		}
		rawLines.push(rawLine);
	}
	flush();
	return blocks;
}

/** For one block, the `AiMarkedParagraph` segments a pending proposal's changed sentences
 * produce - `null` when nothing in this block is targeted, so the caller falls back to
 * normal markdown rendering for everything the marking does not touch. Mentions are
 * stripped to their bare name (`stripMentionSyntax`) rather than resolved to a link:
 * `aiMarking.ts`'s renderer only escapes plain text, and a marked paragraph is a narrow,
 * temporary display state, not the entry's permanent reading flow. */
export function markedSegmentsFor(
	block: EntryBlock,
	changedSentences: ReadonlySet<string>
): ParagraphSegment[] | null {
	if (block.sentences.length === 0) return null;
	const hasMark = block.sentences.some((sentence) => changedSentences.has(sentence));
	if (!hasMark) return null;
	return block.sentences.map((sentence) => ({
		text: stripMentionSyntax(sentence),
		proposed: changedSentences.has(sentence)
	}));
}
