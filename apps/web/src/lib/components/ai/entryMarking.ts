/**
 * Wires V6 = A (#499) into a real entry body (#106): which paragraphs does a pending
 * proposal's semantic diff touch, so the read view can point at them with a change bar
 * instead of ever showing the proposed wording itself (that lives in the diff, #51, C4).
 *
 * Round seventeen's V6 repealed the earlier wiring, which ran a marked paragraph through
 * C1's own marking (`aiMarking.ts`, `AiMarkedParagraph.svelte`) - the GM's own accepted
 * canon wearing "AI wording nobody has accepted" said the opposite of what was true, and
 * paid a second, unfiled cost: that marking's renderer only escapes plain text, so it
 * silently dropped every `[[mention]]` in a paragraph a proposal touched. C1 keeps its
 * mark exactly where it belongs - the diff itself, and Ask's drafted proposals - and
 * never touches this file again.
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

/** A pending `update` proposal's identity, keyed by the exact normalised sentence it
 * would change (`changedSentencesForEntity`'s own key, `$lib/server/proposals`) - what a
 * block's change bar links to. Defined here rather than server-side because the entry
 * page's own render logic (`EntryProseWithSecrets.svelte`) is what consumes it in the
 * browser; the server module imports this type rather than the other way around. */
export interface MarkedProposalRef {
	/** `proposal.id` - the diff itself is rendered elsewhere (#498's surface this round),
	 * never on this page. */
	proposalId: string;
	/** `proposal.planId` - `null` for a proposal outside any plan (Ask's own drafted
	 * proposal, #53), in which case the caller falls back to the plain inbox route. */
	planId: string | null;
}

/** The proposal a change bar beside this block should link to, or `null` when nothing in
 * it is targeted - the caller then renders the block through the normal markdown path for
 * every block, mentions and all, marked or not. First match wins: `changedSentences` is
 * built newest-proposal-first (`changedSentencesForEntity`'s own ordering), so a block two
 * pending proposals both touch links to the more recent one rather than the first found by
 * insertion order. */
export function markedProposalFor(
	block: EntryBlock,
	changedSentences: ReadonlyMap<string, MarkedProposalRef>
): MarkedProposalRef | null {
	for (const sentence of block.sentences) {
		const ref = changedSentences.get(sentence);
		if (ref) return ref;
	}
	return null;
}

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Wraps a block's normally-rendered HTML with V6's change bar: a thin bar in the margin,
 * on `--color-diff-line` (P3's own value signal, the same one the diff itself uses), that
 * says something is waiting here and links to it - never a claim about who wrote the
 * sentence. Pure markup: `contentHtml` is trusted as-is (the caller's own renderer already
 * escaped or resolved it), only `href` and `label` pass through `escapeAttr` since both
 * are attribute values built from server data (a route segment, a translated sentence)
 * rather than from the entry's own text. A real `<a>`, not a `<div>` with a click handler,
 * so it is reachable by keyboard with no extra wiring and its accessible name is exactly
 * what a screen reader announces. */
export function renderChangeBar(contentHtml: string, href: string, label: string): string {
	return `<div class="ai-change-bar-block"><a class="ai-change-bar" href="${escapeAttr(href)}" aria-label="${escapeAttr(label)}"></a>${contentHtml}</div>`;
}
