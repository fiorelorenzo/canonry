/**
 * Semantic diff of an edit (issue #48, SPEC.md §5.1 step 1): "which facts were added,
 * removed, changed."
 *
 * Deterministic, sentence-level text diff - no model call. Nothing in `operation_price`
 * prices this step (only `propagate.plan` and `propagate.diff` do, per issue #52's model
 * routing), and SPEC.md §15 makes an unpriced chargeable call a defect, so this stays a
 * plain algorithm rather than an embedding or generation call. "Semantic" describes the
 * output granularity (one row per fact-sized sentence, not a line-level text diff), not
 * the technique: an LCS match at sentence level finds what is genuinely new or gone, and
 * a word-overlap heuristic turns a coincidental add+remove pair into a single "changed"
 * entry when they are clearly the same fact reworded.
 */
import { splitSecretBlocks } from '@canonry/lang';

export type FactChangeKind = 'added' | 'removed' | 'changed';

export interface FactChange {
	kind: FactChangeKind;
	/** The current text: the new sentence for 'added'/'changed', the removed sentence for
	 * 'removed'. This is what candidate-finding (issue #49) scans for mentions and what a
	 * diff's evidence (issue #51) quotes as the source sentence. */
	statement: string;
	/** Only set for 'changed': the sentence this replaced. */
	previousStatement?: string;
}

const HEADING_RE = /^#{1,6}\s+/;
// Splits a paragraph after sentence-ending punctuation, but only where the next sentence
// plausibly starts (capital letter, digit, or a `[[wikilink]]`) - keeps "Mr. Smith" and
// similar abbreviations from being split mid-name in the fixture-sized bodies this reads.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9[])/;

function splitParagraphIntoSentences(paragraph: string): string[] {
	return paragraph
		.split(SENTENCE_SPLIT_RE)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

/** Splits a markdown body into fact-sized units: one per heading line, one per sentence
 * inside every other paragraph. Blank lines separate paragraphs; a heading is never
 * merged with the paragraph around it, since it is a structural marker, not a fact. */
export function splitIntoSentences(body: string): string[] {
	const units: string[] = [];
	let paragraph: string[] = [];

	const flush = (): void => {
		if (paragraph.length === 0) return;
		const text = paragraph.join(' ').trim();
		if (text) units.push(...splitParagraphIntoSentences(text));
		paragraph = [];
	};

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '') {
			flush();
			continue;
		}
		if (HEADING_RE.test(line)) {
			flush();
			units.push(line);
			continue;
		}
		paragraph.push(line);
	}
	flush();
	return units;
}

/** `splitIntoSentences`, but no sentence ever spans a `:::secret`/`:::gmnote` boundary.
 *
 * The plain splitter knows nothing about a fence, so a marker line is just a line: it
 * joins whichever paragraph it sits next to, and the sentence that comes back is markup
 * glued to prose, or two halves of two different thoughts. That is wrong wherever a
 * sentence is going to be quoted back to a reader as evidence, which is every caller
 * below. Splitting each `splitSecretBlocks` segment separately means every sentence comes
 * from one side of a fence or the other.
 *
 * This is deliberately about the *shape* of the sentence and not about hiding a secret.
 * Every caller here is GM-only, so a sentence drawn from inside a fence is fine to
 * surface; `stripSecretsForPlayers` is what a player-facing surface uses, and it is a
 * different question with a different answer.
 *
 * Every caller in the package uses this one now. `ask.ts` kept a private variant until
 * #535, because it also tracked each sentence's offset into the whole body to fill
 * `OwnCanonSource.spanStart`/`spanEnd`; nothing ever read those two numbers, #535 deleted
 * them, and the variant went with them. Found the hard way four times (#355, #556, #559,
 * #545), which is why this lives beside the splitter it corrects rather than being copied
 * a fifth time. */
export function fenceSafeSentences(body: string): string[] {
	const sentences: string[] = [];
	for (const segment of splitSecretBlocks(body)) {
		sentences.push(...splitIntoSentences(segment.text));
	}
	return sentences;
}

/** A word's own apostrophes, and the two of them that carry no meaning worth a separate
 * token. Applied in this order: an English possessive `'s` comes off first, then whatever
 * apostrophes are left at either end of the word. An apostrophe *inside* a word is never
 * touched.
 *
 * Issue #577. The token pattern below has always included `'`, so `Smugglers'` and
 * `Smugglers` were two unrelated tokens and the sample world's entry The Smugglers'
 * Ledger could not be found by a GM who typed its name without the apostrophe. Both forms
 * mean the same word, and a lexical layer that treats them as different words is not
 * being strict, it is being wrong about English.
 *
 * **Trailing only, and that is a decision about Italian.** In Italian an apostrophe is an
 * elision rather than a possessive and it sits *inside* the word: `l'oste`, `dell'inverno`,
 * `un'ora`, `nell'ombra`. Splitting on it would be a different fix with a different blast
 * radius, and a bad one here: `@canonry/lang`'s Italian function-word list carries `un`
 * and `all` but no bare `l`, `dell`, `nell` or `d`, so the halves of an elision would
 * arrive at Ask's content-word filter as content words and score matches on the article.
 * So an internal apostrophe is left exactly as it was, every one of those words tokenizes
 * today as it did before, and Italian elision stays an open question rather than a
 * side effect. The one Italian token this does move is `c'`, from `c'è` (the `è` is outside
 * the pattern's alphabet, so the token was already truncated): it becomes `c`, on both
 * sides at once, because the function-word list is tokenized through this very function.
 *
 * That last part is what keeps the possessive strip from leaking into the function-word
 * filter as well. Every `X's` in the English list normalises onto a base that list already
 * carries (`it's`/`it`, `that's`/`that`, `there's`/`there`, `who's`/`who`), with one
 * exception worth naming rather than hiding: `let's` becomes `let`, so a canon sentence's
 * ordinary verb "let" is now filtered as a function word. One word, in exchange for every
 * possessive in a world's canon matching its plain form. */
const POSSESSIVE_SUFFIX_RE = /'s$/;
const EDGE_APOSTROPHES_RE = /^'+|'+$/g;

/** Exported for `ask.ts` (own-canon relevance scoring) and `audit.ts` (picking the most
 * topically similar sentence in a candidate entity's body): a small, deterministic
 * word-overlap measure, not a private implementation detail of the semantic diff alone. */
export function tokenize(sentence: string): Set<string> {
	const words = sentence.toLowerCase().match(/[a-z0-9']+/g) ?? [];
	const tokens = new Set<string>();
	for (const word of words) {
		const normalised = word.replace(POSSESSIVE_SUFFIX_RE, '').replace(EDGE_APOSTROPHES_RE, '');
		// An apostrophe on its own, or a bare `'s`, is punctuation the pattern happened to
		// match. It was a token before this and never carried anything.
		if (normalised.length > 0) tokens.add(normalised);
	}
	return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let intersection = 0;
	for (const word of a) if (b.has(word)) intersection++;
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/** Below this word-overlap ratio, a removed and an added sentence are treated as an
 * unrelated deletion plus an unrelated addition rather than one edited fact. */
const CHANGE_SIMILARITY_THRESHOLD = 0.4;

interface LcsResult {
	keptOld: Set<number>;
	keptNew: Set<number>;
}

/** Longest common subsequence over sentence arrays (exact text match per sentence), so
 * everything genuinely unchanged - including a sentence that also happens to occur
 * elsewhere in the body - never shows up as a fact change. */
function lcs(oldSentences: string[], newSentences: string[]): LcsResult {
	const n = oldSentences.length;
	const m = newSentences.length;
	const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i]![j] =
				oldSentences[i] === newSentences[j]
					? table[i + 1]![j + 1]! + 1
					: Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}

	const keptOld = new Set<number>();
	const keptNew = new Set<number>();
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (oldSentences[i] === newSentences[j]) {
			keptOld.add(i);
			keptNew.add(j);
			i++;
			j++;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
			i++;
		} else {
			j++;
		}
	}
	return { keptOld, keptNew };
}

/** Which facts an edit added, removed and changed (issue #48). Sentence order in the
 * output follows the new body's reading order for added/changed entries, with pure
 * removals appended at the end in their original order. */
export function semanticDiff(oldBody: string, newBody: string): FactChange[] {
	const oldSentences = splitIntoSentences(oldBody);
	const newSentences = splitIntoSentences(newBody);
	const { keptOld, keptNew } = lcs(oldSentences, newSentences);

	const removedIndices = oldSentences.map((_, i) => i).filter((i) => !keptOld.has(i));
	const addedIndices = newSentences.map((_, j) => j).filter((j) => !keptNew.has(j));

	// Greedily pair the best-matching removed/added sentences above the similarity floor,
	// highest similarity first, so a clean rewrite pairs before a coincidental partial
	// overlap steals its match.
	const candidates: Array<{ oldIdx: number; newIdx: number; score: number }> = [];
	for (const oldIdx of removedIndices) {
		const oldTokens = tokenize(oldSentences[oldIdx]!);
		for (const newIdx of addedIndices) {
			const score = jaccard(oldTokens, tokenize(newSentences[newIdx]!));
			if (score >= CHANGE_SIMILARITY_THRESHOLD) candidates.push({ oldIdx, newIdx, score });
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	const pairedOld = new Map<number, number>(); // oldIdx -> newIdx
	const pairedNew = new Set<number>();
	for (const candidate of candidates) {
		if (pairedOld.has(candidate.oldIdx) || pairedNew.has(candidate.newIdx)) continue;
		pairedOld.set(candidate.oldIdx, candidate.newIdx);
		pairedNew.add(candidate.newIdx);
	}

	const changes: FactChange[] = [];
	const newIdxToOldIdx = new Map<number, number>();
	for (const [oldIdx, newIdx] of pairedOld) newIdxToOldIdx.set(newIdx, oldIdx);

	for (const newIdx of addedIndices) {
		const oldIdx = newIdxToOldIdx.get(newIdx);
		if (oldIdx !== undefined) {
			changes.push({
				kind: 'changed',
				statement: newSentences[newIdx]!,
				previousStatement: oldSentences[oldIdx]!
			});
		} else {
			changes.push({ kind: 'added', statement: newSentences[newIdx]! });
		}
	}
	for (const oldIdx of removedIndices) {
		if (!pairedOld.has(oldIdx)) changes.push({ kind: 'removed', statement: oldSentences[oldIdx]! });
	}

	return changes;
}
