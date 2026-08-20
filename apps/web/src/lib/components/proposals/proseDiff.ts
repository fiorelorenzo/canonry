/**
 * The diff a reviewer actually reads (Q1, round twelve in `docs/ux/DECISIONS.md`, issue
 * #362). C4 chose "in place with a toggle" and Q1 repeals the toggle: every changed part
 * of the entry shows at once, with enough unchanged text around it to read.
 *
 * This is pure logic over two strings and nothing else. `proposal.patch` has carried
 * `{ summary, before, after }` since migration 0005, so both whole bodies are already
 * stored and a diff with context is derived from them the way a forge diffs two blobs -
 * no column, no migration, nothing new written.
 *
 * **The unit is a fact, not a line.** Canon bodies are prose: a paragraph is one long
 * line, so a line diff would mark a whole paragraph changed for one reworded clause, and
 * a character diff would scatter marks through words. The unit here is the one the rest
 * of the pipeline already uses, `splitIntoSentences` from `@canonry/copilot`: one unit per
 * heading, one per sentence. That is the same boundary candidate-finding scans and the
 * same boundary a proposal's evidence quotes (`packages/copilot/src/diff.ts`), so a
 * region of this diff and a sentence of that evidence are the same object.
 *
 * Inside a unit that was reworded rather than replaced, the marking goes down to words,
 * because "he was dismissed from the watch" against "he is captain of the watch again"
 * reads as one sentence with two edits and not as two sentences.
 *
 * Colour is P3's, and P3 is why there is no red and green here: the diff moves in
 * lightness (`--color-diff-bg`, `--color-diff-line`) and C1's marking moves in hue, so a
 * sentence can be both changed and unaccepted and read as both. Removal against addition
 * is carried by shape - a strikethrough, and the marking on arriving text - plus a
 * screen-reader label in the card, never by hue.
 */
import { jaccard, splitIntoSentences, tokenize } from '@canonry/copilot';

/** A word-level run inside a reworded unit, in the order the sentence reads: `kept` words
 * stay, `removed` words are struck, `added` words are the new wording. */
export interface ProseSpan {
	kind: 'kept' | 'removed' | 'added';
	text: string;
}

/** One row of the rendered diff, in the entry's own reading order. A `gap` stands for the
 * unchanged units elided between two regions, counted rather than drawn: prose has no
 * line numbers, so "4 unchanged sentences" is the honest form of a hunk header. */
export type ProseDiffRow =
	| { kind: 'gap'; units: number }
	| { kind: 'kept'; text: string; heading: boolean }
	| { kind: 'added'; text: string; heading: boolean }
	| { kind: 'removed'; text: string; heading: boolean }
	| {
			kind: 'changed';
			text: string;
			previousText: string;
			spans: ProseSpan[];
			heading: boolean;
	  };

export interface ProseDiff {
	rows: ProseDiffRow[];
	/** How many separate places in the entry changed: one per run of adjacent changed
	 * rows. What the card says out loud, so a reader knows how many regions to look at
	 * before scrolling. */
	regions: number;
}

export const EMPTY_PROSE_DIFF: ProseDiff = { rows: [], regions: 0 };

/** Unchanged units kept on each side of a changed one. One sentence, not three: canon
 * sentences are long, and the job of context is to place a change in its paragraph rather
 * than to reprint the entry. */
const CONTEXT_UNITS = 1;

/** A run of unchanged units shorter than this is printed rather than counted away: a gap
 * marker standing in for one sentence costs the reader more attention than the sentence
 * itself would, and it is how you end up with "1 unchanged" twice around a heading. */
const MIN_ELIDED_UNITS = 2;

/** Two units pair into one reworded unit above this word overlap, and read as an
 * unrelated deletion plus an unrelated addition below it. Same threshold and same measure
 * as `semanticDiff`'s `CHANGE_SIMILARITY_THRESHOLD`, deliberately: a pair this diff calls
 * a rewording is the same pair the copilot calls a changed fact. */
const PAIR_SIMILARITY_THRESHOLD = 0.4;

/** Below this share of words surviving, word-level marking is confetti and the unit is
 * shown as a whole sentence replaced instead. A pair only gets here having cleared
 * `PAIR_SIMILARITY_THRESHOLD` on its vocabulary, so what this catches is the pair that
 * reuses the same words in a different order. */
const WORD_LEVEL_MIN_KEPT = 0.4;

/** `splitIntoSentences` emits a heading line as its own unit; this is how a row knows it
 * is one. The markers come off for display, since the card renders text and not markdown
 * (`lib/markdown.ts` and the prose components belong to #364), and markdown stays the
 * stored form regardless - nothing here writes. */
const HEADING_RE = /^(#{1,6})\s+/;

function isHeading(unit: string): boolean {
	return HEADING_RE.test(unit);
}

function displayText(unit: string): string {
	return unit.replace(HEADING_RE, '');
}

interface Op {
	kind: 'kept' | 'removed' | 'added';
	text: string;
}

/** Aligns two item lists into one sequence in reading order, by longest common
 * subsequence over exact equality. Unlike `semanticDiff`, which answers "which facts
 * changed" as a set, this keeps every item and its position, because position is what
 * context is made of. Runs at both scales: units within a body, words within a unit. */
function align(before: readonly string[], after: readonly string[]): Op[] {
	const n = before.length;
	const m = after.length;
	const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i]![j] =
				before[i] === after[j]
					? table[i + 1]![j + 1]! + 1
					: Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}

	const ops: Op[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (before[i] === after[j]) {
			ops.push({ kind: 'kept', text: after[j]! });
			i++;
			j++;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
			ops.push({ kind: 'removed', text: before[i]! });
			i++;
		} else {
			ops.push({ kind: 'added', text: after[j]! });
			j++;
		}
	}
	while (i < n) ops.push({ kind: 'removed', text: before[i++]! });
	while (j < m) ops.push({ kind: 'added', text: after[j++]! });
	return ops;
}

/** Word-level marking inside one reworded unit. Returns whole-sentence replacement spans
 * where too little survives for word marks to help. */
export function wordSpans(previous: string, next: string): ProseSpan[] {
	const before = previous.split(/\s+/).filter((word) => word.length > 0);
	const after = next.split(/\s+/).filter((word) => word.length > 0);
	const ops = align(before, after);
	const kept = ops.filter((op) => op.kind === 'kept').length;
	const longest = Math.max(before.length, after.length);
	if (longest === 0 || kept / longest < WORD_LEVEL_MIN_KEPT) {
		return [
			{ kind: 'removed', text: previous },
			{ kind: 'added', text: next }
		];
	}

	const spans: ProseSpan[] = [];
	for (const op of ops) {
		const last = spans.at(-1);
		if (last && last.kind === op.kind) last.text = `${last.text} ${op.text}`;
		else spans.push({ kind: op.kind, text: op.text });
	}
	return spans;
}

/** Turns one run of adjacent removals and additions into rows: each removal paired with
 * the addition that rewords it, best pair first, and whatever is left standing alone.
 * A heading never pairs with a sentence, since a retitled section and a rewritten fact
 * are different claims. */
function rowsForBlock(block: Op[]): ProseDiffRow[] {
	const removed = block.filter((op) => op.kind === 'removed').map((op) => op.text);
	const added = block.filter((op) => op.kind === 'added').map((op) => op.text);

	const scored: Array<{ removedIdx: number; addedIdx: number; score: number }> = [];
	removed.forEach((previous, removedIdx) => {
		const previousTokens = tokenize(previous);
		added.forEach((next, addedIdx) => {
			if (isHeading(previous) !== isHeading(next)) return;
			const score = jaccard(previousTokens, tokenize(next));
			if (score >= PAIR_SIMILARITY_THRESHOLD) scored.push({ removedIdx, addedIdx, score });
		});
	});
	scored.sort((a, b) => b.score - a.score || a.removedIdx - b.removedIdx);

	const pairedRemoved = new Map<number, number>();
	const pairedAdded = new Map<number, number>();
	for (const pair of scored) {
		if (pairedRemoved.has(pair.removedIdx) || pairedAdded.has(pair.addedIdx)) continue;
		pairedRemoved.set(pair.removedIdx, pair.addedIdx);
		pairedAdded.set(pair.addedIdx, pair.removedIdx);
	}

	const rows: ProseDiffRow[] = [];
	// What leaves outright is printed before what arrives, the way a unified diff puts its
	// removals above its additions, so the block reads old-then-new without a hue saying so.
	removed.forEach((previous, removedIdx) => {
		if (pairedRemoved.has(removedIdx)) return;
		rows.push({ kind: 'removed', text: displayText(previous), heading: isHeading(previous) });
	});
	added.forEach((next, addedIdx) => {
		const removedIdx = pairedAdded.get(addedIdx);
		if (removedIdx === undefined) {
			rows.push({ kind: 'added', text: displayText(next), heading: isHeading(next) });
			return;
		}
		const previous = removed[removedIdx]!;
		rows.push({
			kind: 'changed',
			text: displayText(next),
			previousText: displayText(previous),
			spans: wordSpans(displayText(previous), displayText(next)),
			heading: isHeading(next)
		});
	});
	return rows;
}

/** Drops the unchanged units nobody needs and counts what it dropped. The heading a
 * region sits under is always kept, however far above it is: "this changed under
 * History" is context a neighbouring sentence cannot give. */
function elide(rows: ProseDiffRow[]): ProseDiffRow[] {
	const keep = new Set<number>();
	rows.forEach((row, index) => {
		if (row.kind === 'kept') return;
		for (let offset = -CONTEXT_UNITS; offset <= CONTEXT_UNITS; offset++) {
			const neighbour = index + offset;
			if (neighbour >= 0 && neighbour < rows.length) keep.add(neighbour);
		}
		for (let above = index - 1; above >= 0; above--) {
			const candidate = rows[above]!;
			if (candidate.kind !== 'kept') break;
			if (candidate.heading) {
				keep.add(above);
				break;
			}
		}
	});

	const out: ProseDiffRow[] = [];
	let dropped: ProseDiffRow[] = [];
	const flushGap = (): void => {
		if (dropped.length >= MIN_ELIDED_UNITS) out.push({ kind: 'gap', units: dropped.length });
		else out.push(...dropped);
		dropped = [];
	};
	rows.forEach((row, index) => {
		if (keep.has(index)) {
			flushGap();
			out.push(row);
		} else {
			dropped.push(row);
		}
	});
	flushGap();
	return out;
}

function countRegions(rows: readonly ProseDiffRow[]): number {
	let regions = 0;
	let inside = false;
	for (const row of rows) {
		const changed = row.kind === 'added' || row.kind === 'removed' || row.kind === 'changed';
		if (changed && !inside) regions++;
		inside = changed;
	}
	return regions;
}

/** The whole derivation: two bodies in, the rows a reviewer reads out. An entry whose body
 * did not change yields no rows at all rather than a wall of context, and a brand new
 * entry (`before` empty) yields every unit as added, which is what accepting one is. */
export function proseDiff(before: string, after: string): ProseDiff {
	const beforeUnits = splitIntoSentences(before);
	const afterUnits = splitIntoSentences(after);
	const ops = align(beforeUnits, afterUnits);

	const rows: ProseDiffRow[] = [];
	let block: Op[] = [];
	const flushBlock = (): void => {
		if (block.length === 0) return;
		rows.push(...rowsForBlock(block));
		block = [];
	};
	for (const op of ops) {
		if (op.kind === 'kept') {
			flushBlock();
			rows.push({ kind: 'kept', text: displayText(op.text), heading: isHeading(op.text) });
		} else {
			block.push(op);
		}
	}
	flushBlock();

	const regions = countRegions(rows);
	if (regions === 0) return EMPTY_PROSE_DIFF;
	return { rows: elide(rows), regions };
}
