/**
 * Function words per locale (issue #346), for the one job a lexical search cannot do
 * without them: telling a match that rests on a shared idea from a match that rests on a
 * shared "of the".
 *
 * Ask's own-canon layer (`packages/copilot/src/ask.ts`) scores every sentence in a world
 * against the question by word overlap, and its only condition for calling a sentence a
 * source was that the overlap be greater than zero. Measured against the seeded sample
 * world, every single match a broad question produced rested on a function word: "What
 * kind of world is this?" returned six sentences whose shared words were `of`, `is`,
 * `the`, `in` and `this`, and "Che tipo di mondo e questo?" matched on `di`, `i` and `e`.
 * Dropping those words from both sides takes that question from six sources to one and
 * leaves every targeted question's sources intact, which is the measurement recorded on
 * #346. No threshold does the same job: the same run scored a coincidence at 0.20 and a
 * real citation at 0.12, so no floor separates them.
 *
 * Three things about the shape of this data, each of which is a decision:
 *
 * - **Written in ordinary orthography, tokenized by the caller.** The list is
 *   `readonly string[]` of words as a person writes them, and the searcher runs them
 *   through the very same tokenizer it runs canon and questions through. That is what
 *   makes the comparison exact under a tokenizer that drops accents (Italian `perché`
 *   and a canon sentence's `perché` both become `perch`) without this file having to
 *   know that, and it keeps one tokenizer in the codebase rather than two that agree
 *   until they do not.
 * - **A published-shape list, not a tuned one.** These are the ordinary closed classes,
 *   articles, prepositions, conjunctions, pronouns, auxiliaries, determiners and
 *   question words. Nothing here was added because it improved a demo question, which
 *   matters: a list tuned against the sample world would measure the sample world.
 * - **Two deliberate omissions.** Numerals are not function words here (`due` is in most
 *   Italian stopword lists, and a world where two ports matter wants to be able to ask
 *   which two; `un`, `una` and `uno` are in, because in Italian they are the indefinite
 *   article before they are the number), and neither is Italian `stato`, which is a past
 *   participle and also a polity, nor English `will`, which is an auxiliary and also a
 *   bequest. Each would have cost a real question to buy a marginal match.
 *
 * A locale with no entry falls back to no filtering, which is the behaviour that shipped
 * before this existed: a new locale is worse at layer 1 until its list is written, rather
 * than broken. Both locales the product ships have one.
 */
import { LOCALES, type Locale } from './locale.js';

const EN = `a about above after again against all am an and any are aren't as at be because
been before being below between both but by can cannot can't could couldn't did didn't do
does doesn't doing don't down during each few for from further had hadn't has hasn't have
haven't having he he'd he'll he's her here here's hers herself him himself his how how's i
i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my
myself no nor not now of off on once only or other ought our ours ourselves out over own same
shan't she she'd she'll she's should shouldn't so some such than that that's the their
theirs them themselves then there there's these they they'd they'll they're they've this
those through to too under until up very was wasn't we we'd we'll we're we've were weren't
what what's when when's where where's which while who whom who's whose why why's with
won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`;

const IT = `a ad affinché agli ai al all alla alle allo anche ancora avere avete abbiamo ha
hai hanno ho c'è che chi ci coi col come con contro cosa cui da dagli dai dal dalla dalle dallo
degli dei del della delle dello di dove e ed è era erano essere fra gli i il in io la le
lei li lo loro ma me mi mia mie miei mio molto ne né negli nei nel nella nelle nello no
noi non nostra nostre nostri nostro o ogni oppure per perché però più poco poi presso qua
quale quali quando quanta quante quanti quanto quel quella quelle quelli quello questa
queste questi questo qui se sei senza si sia siamo siete solo sono sopra sotto sta su sua
sue sui sul sulla sulle sullo suo suoi te ti tra tu tua tue tuo tuoi tutta tutte tutti
tutto un una uno vi voi vostra vostre vostri vostro`;

const BY_LOCALE: Partial<Record<Locale, readonly string[]>> = {
	en: EN.split(/\s+/),
	it: IT.split(/\s+/)
};

/** The function words of `locale`, as written rather than as tokenized. Empty for a locale
 * whose list has not been written yet, which the caller reads as "filter nothing". */
export function functionWords(locale: Locale): readonly string[] {
	return BY_LOCALE[locale] ?? [];
}

/** Every locale that has a list, so a test can assert the set rather than restate it. */
export const LOCALES_WITH_FUNCTION_WORDS: readonly Locale[] = LOCALES.filter(
	(locale) => BY_LOCALE[locale] !== undefined
);
