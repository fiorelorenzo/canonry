// SPEC.md §17: a per-entry content language, "detected from the body at write time by a free
// heuristic and never by a model call".
//
// Why a heuristic rather than a model: this runs on every save of every entry, it has to be
// deterministic so a test can assert it, it must work with the AI switched off entirely
// (guardrail 4), and it must cost nothing, because charging a GM to find out that their own
// entry is in Italian would be absurd. Function words are the strongest cheap signal for this
// pair: frequent, short, and almost never shared between English and Italian.
//
// Two things this got wrong on the first pass, both found by its own tests, both fixed here by
// changing the rule rather than by tuning a constant:
//
//   * a roster of proper nouns scored as English, because "The Gilded Rat", "The Ashen Ledger"
//     and "The Valdoria Watch" contribute three hits for "the". Markers are now only counted
//     when they appear lowercase in the source, so an article inside a name is not evidence
//     about the language of the prose around it;
//   * a body containing one English paragraph and one Italian paragraph picked a winner,
//     because English function words are simply denser. The decision is now taken per sentence
//     and then over the sentences, so a body whose sentences disagree is mixed by definition
//     rather than by margin.
//
// Null is a real answer and callers must treat it as one: an entry whose language nobody knows
// is not an entry to start writing English into by default.

import { isLocale, LOCALES, type Locale } from './locale.js';

/** Function words, and only function words. Nouns would drag proper nouns into the count, and
 * a world full of Italian place names written up in English is exactly the case this must not
 * mislabel. */
const MARKERS: Record<Locale, ReadonlySet<string>> = {
	en: new Set([
		'the',
		'and',
		'of',
		'to',
		'in',
		'that',
		'is',
		'was',
		'for',
		'with',
		'his',
		'her',
		'their',
		'they',
		'this',
		'from',
		'has',
		'have',
		'been',
		'but',
		'not',
		'who',
		'which',
		'after',
		'before',
		'still',
		'about',
		'into',
		'over',
		'than',
		'when',
		'while',
		'because',
		'nobody',
		'anyone',
		'him',
		'she',
		'it',
		'at',
		'on',
		'now'
	]),
	it: new Set([
		'il',
		'lo',
		'la',
		'le',
		'gli',
		'un',
		'una',
		'uno',
		'di',
		'del',
		'della',
		'dei',
		'delle',
		'che',
		'per',
		'con',
		'non',
		'sono',
		'era',
		'come',
		'anche',
		'nel',
		'nella',
		'alla',
		'allo',
		'suo',
		'sua',
		'loro',
		'questo',
		'questa',
		'quando',
		'perche',
		'perché',
		'ancora',
		'dopo',
		'prima',
		'nessuno',
		'più',
		'piu',
		'sulla',
		'sul',
		'ora',
		'gli',
		'ha',
		'dalla',
		'dal',
		'chiede'
	])
};

/** Below this many words there is not enough text to be right about. */
const MIN_WORDS = 8;
/** A winner needs this many marker hits at all, so a page of names stays unknown. */
const MIN_HITS = 2;
/** And this much more than the runner-up, or the text is treated as undecided. */
const MIN_MARGIN = 1.5;
/** A sentence needs this many words before its own vote counts for anything. */
const MIN_SENTENCE_WORDS = 5;
/** If the losing language wins at least this share of the sentences, the body is mixed. */
const MIXED_SHARE = 0.25;

interface Counted {
	hits: Record<Locale, number>;
	wordCount: number;
}

/** Counts marker hits, ignoring any occurrence that is capitalised in the source.
 *
 * That single rule is what stops "The Gilded Rat" from being evidence about English. It costs
 * the sentence-initial article, which is fine: any body long enough to be worth labelling has
 * plenty of lowercase function words, and any body that does not is one this should refuse to
 * label anyway. Apostrophes split on purpose, because Italian elides constantly
 * ("dell'oste", "l'oste") and keeping the article attached would hide its strongest markers. */
function count(text: string): Counted {
	const tokens = text
		.normalize('NFC')
		.split(/[^\p{Letter}\p{Mark}]+/u)
		.filter(Boolean);
	const hits: Record<Locale, number> = { en: 0, it: 0 };
	for (const token of tokens) {
		const first = token[0];
		if (!first || first !== first.toLowerCase()) continue;
		const lower = token.toLowerCase();
		for (const locale of LOCALES) if (MARKERS[locale].has(lower)) hits[locale] += 1;
	}
	return { hits, wordCount: tokens.length };
}

function decide({ hits, wordCount }: Counted, minWords: number): Locale | null {
	if (wordCount < minWords) return null;
	// Defaults rather than a cast: LOCALES always has two entries, but saying so with `as`
	// would be an assertion where a default is precise.
	const [best = 'en', second = 'en'] = [...LOCALES].sort((a, b) => hits[b] - hits[a]);
	if (hits[best] < MIN_HITS) return null;
	if (hits[best] < hits[second] * MIN_MARGIN) return null;
	return best;
}

export interface LanguageGuess {
	language: Locale | null;
	/** Marker hits per locale, exposed so a test can say why rather than only what, and so a
	 * third locale can be tuned against real bodies instead of by feel. */
	hits: Record<Locale, number>;
	wordCount: number;
	/** How the sentences voted. A body whose sentences disagree is mixed, which is a different
	 * fact from a body nobody can read. */
	sentenceVotes: Record<Locale, number>;
}

/** Guesses which of our languages a body is written in, or returns null when it does not know. */
export function guessLanguage(text: string): LanguageGuess {
	const whole = count(text);
	const votes: Record<Locale, number> = { en: 0, it: 0 };
	for (const sentence of text.split(/(?<=[.!?;:\n])\s+/)) {
		const counted = count(sentence);
		if (counted.wordCount < MIN_SENTENCE_WORDS) continue;
		const winner = decide(counted, MIN_SENTENCE_WORDS);
		if (winner) votes[winner] += 1;
	}

	const decided = decide(whole, MIN_WORDS);
	const totalVotes = votes.en + votes.it;
	const base = {
		hits: whole.hits,
		wordCount: whole.wordCount,
		sentenceVotes: votes
	};
	if (!decided) return { language: null, ...base };
	// Sentences that disagree beat the aggregate: one dense English paragraph should not label a
	// body whose other half is Italian, because the label decides what gets written into it.
	if (totalVotes > 1) {
		const loser: Locale = decided === 'en' ? 'it' : 'en';
		if (votes[loser] / totalVotes >= MIXED_SHARE) return { language: null, ...base };
	}
	return { language: decided, ...base };
}

/** The common call: just the language, or null. */
export function detectLanguage(text: string): Locale | null {
	return guessLanguage(text).language;
}

function toContentLanguage(value: string | null | undefined): Locale | null {
	if (!value) return null;
	const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	return isLocale(primary) ? primary : null;
}

/**
 * The language the copilot must write in when its output will land inside an entry.
 *
 * The fallback chain is §17's, and its last step is deliberately not the interface locale: an
 * Italian interface must never cause Italian prose to be written into an entry nobody has
 * established the language of. When the target entry is unknowable, the entry that triggered
 * the change is the better guess, because they are at least both canon.
 */
export function canonLanguageFor(input: {
	targetLanguage?: string | null;
	targetBody?: string | null;
	triggerLanguage?: string | null;
	triggerBody?: string | null;
}): Locale {
	return (
		toContentLanguage(input.targetLanguage) ??
		(input.targetBody ? detectLanguage(input.targetBody) : null) ??
		toContentLanguage(input.triggerLanguage) ??
		(input.triggerBody ? detectLanguage(input.triggerBody) : null) ??
		'en'
	);
}
