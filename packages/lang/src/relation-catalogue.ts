/**
 * Issue #197: the shipped relation-type catalogue's per-locale display strings, in one
 * place both `packages/copilot` and `apps/web` read from.
 *
 * Lives here rather than in `apps/web/src/lib/i18n` because two things need every
 * locale's strings before a request ever reaches the app: `resolveRelationType`'s rungs
 * one and two (this package's `relation-types.ts`) have to match a proposed label against
 * the *whole* catalogue, not just the caller's active locale - an Italian corpus proposes
 * Italian words regardless of which locale happens to be reading the resulting review
 * queue - and `packages/import`'s job-runner calls that resolver directly, a package that
 * cannot import from `apps/web`. `apps/web/src/lib/i18n/{en,it}.ts` re-export the slice
 * they need for `Messages.relationTypeLabel` from here instead of each keeping its own
 * copy of the same ten-entry object literal, so there is still exactly one literal per
 * language for a translator to find, just owned by this package rather than duplicated
 * into two.
 *
 * `en.ts`/`it.ts` import this file through the package's `./relation-catalogue` subpath
 * export (`package.json`), never through the package root - the root barrel
 * (`index.ts`) also re-exports `complete.ts`/`audit.ts`/`ask.ts` and the rest, which pull
 * in the `ai` SDK, gateway wiring and server-only secrets. `en.ts`/`it.ts` ship to the
 * browser (ordinary `.svelte` components import `Messages`), so an import through the
 * root would drag that entire server graph into the client bundle - not a bundle-size
 * nitpick, it breaks hydration outright, since dev-mode ESM loads every module a barrel
 * re-exports regardless of which name a caller actually uses. This module itself only
 * imports `@canonry/lang`'s `Locale`/`LOCALES`, so it is safe as a standalone entry
 * point; nothing else in this package should gain a dependency that changes that.
 *
 * Not injected through `ResolveRelationTypeDeps` the way `embed` is, on purpose: `embed`
 * varies by environment (a live gateway model in production, a deterministic stub in
 * tests) and that is exactly what makes it worth a seam. This catalogue is the opposite -
 * fixed shipped content, identical in every environment, and it has to be the *full*
 * multi-locale map regardless of who is calling, so there is nothing a caller could
 * legitimately override it with. Threading it through `ResolveRelationTypeDeps` and every
 * caller between here and `packages/import`'s job-runner (which does not otherwise know
 * or care about locales) would be plumbing with no seam behind it.
 *
 * Keys match `relation_type.key` exactly (decision L1, #195) for the ten shipped rows. A
 * universe's own type has no entry here, same rule `Messages.relationTypeLabel`'s own doc
 * comment states - #198 is where a GM's own type gets a per-locale label of its own.
 */
import { LOCALES, type Locale } from './locale.js';

export interface RelationTypeCatalogueEntry {
	label: string;
	inverseLabel: string;
}

export const RELATION_TYPE_CATALOGUE: Record<Locale, Record<string, RelationTypeCatalogueEntry>> = {
	en: {
		commands: { label: 'commands', inverseLabel: 'commanded by' },
		employs: { label: 'employs', inverseLabel: 'employed by' },
		located_in: { label: 'located in', inverseLabel: 'contains' },
		member_of: { label: 'member of', inverseLabel: 'has member' },
		ally_of: { label: 'ally of', inverseLabel: 'ally of' },
		parent_of: { label: 'parent of', inverseLabel: 'child of' },
		owns: { label: 'owns', inverseLabel: 'owned by' },
		appointed: { label: 'appointed', inverseLabel: 'appointed by' },
		part_of: { label: 'part of', inverseLabel: 'contains' },
		protects: { label: 'protects', inverseLabel: 'protected by' }
	},
	it: {
		commands: { label: 'comanda', inverseLabel: 'comandato da' },
		employs: { label: 'impiega', inverseLabel: 'impiegato da' },
		located_in: { label: 'si trova in', inverseLabel: 'contiene' },
		member_of: { label: 'membro di', inverseLabel: 'ha come membro' },
		ally_of: { label: 'alleato di', inverseLabel: 'alleato di' },
		parent_of: { label: 'genitore di', inverseLabel: 'figlio di' },
		owns: { label: 'possiede', inverseLabel: 'posseduto da' },
		appointed: { label: 'nomina', inverseLabel: 'nominato da' },
		part_of: { label: 'parte di', inverseLabel: 'contiene' },
		protects: { label: 'protegge', inverseLabel: 'protetto da' }
	}
};

/** The narrow shape this module needs off a relation type row - just enough to stay
 * decoupled from `@canonry/db`'s schema types, since a catalogue lookup has no other
 * reason to depend on drizzle's inferred row shape. */
export interface RelationTypeIdentity {
	key: string;
	label: string;
	inverseLabel: string;
	universeId: string | null;
}

/** Every label string `type` is known by, forward and inverse, across every shipped
 * locale - the expanded set both of `resolveRelationType`'s rungs match a proposed label
 * against (#197). The row's own stored `label`/`inverseLabel` (English, from the seed
 * migration) is always included first so a caller that only wants "the" label keeps
 * getting it as the first entry; a universe's own type (`universeId` not null) has no
 * catalogue entry, so its set is just that one pair, unchanged from before this issue.
 * Deduplicated so a locale whose string happens to equal the stored one (nothing does
 * today, but nothing prevents it) does not produce two identical rung-1 candidates. */
export function relationTypeMatchCandidates(
	type: RelationTypeIdentity
): Array<{ label: string; direction: 'forward' | 'inverse' }> {
	const seen = new Set<string>();
	const out: Array<{ label: string; direction: 'forward' | 'inverse' }> = [];
	const add = (label: string, direction: 'forward' | 'inverse'): void => {
		const dedupeKey = `${direction}:${label}`;
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		out.push({ label, direction });
	};
	add(type.label, 'forward');
	add(type.inverseLabel, 'inverse');
	if (type.universeId === null) {
		for (const locale of LOCALES) {
			const entry = RELATION_TYPE_CATALOGUE[locale][type.key];
			if (!entry) continue;
			add(entry.label, 'forward');
			add(entry.inverseLabel, 'inverse');
		}
	}
	return out;
}

/** `type`'s display label in `locale` - the catalogue's translation for a shipped type,
 * falling back to the row's own stored label exactly like `Messages.relationTypeLabel`
 * does for an unrecognised key, or the row's stored label outright for a universe's own
 * type (SPEC.md §17 rule 3: canon stays in the language it was authored in, and guardrail
 * 1 forbids a model silently rewriting a GM's own words). Used for prompt text
 * (`complete.ts`, `diffs.ts`) - never for matching, which is `relationTypeMatchCandidates`'s
 * job instead. */
export function localizedRelationLabel(type: RelationTypeIdentity, locale: Locale): string {
	if (type.universeId !== null) return type.label;
	return RELATION_TYPE_CATALOGUE[locale][type.key]?.label ?? type.label;
}

/** Picks one row per `key` out of `types` - a universe's own type always wins over the
 * shipped catalogue's row on a tie, the same preference `relation-types.ts`'s own
 * `preferUniverseOwned` applies during matching. Needed because `relationTypesForUniverse`
 * can legitimately return two rows sharing a key: a GM is allowed to reuse a shipped
 * label for their own type (`relation.test.ts`'s "allows a universe-scoped relation type
 * to reuse a label from the shipped catalogue"), and the trigger that derives a universe
 * row's key from its label (migration 0032) then derives the same key text the shipped
 * row already has. `complete.ts`/`diffs.ts` use this to build the `key -> row` lookup
 * `localizedRelationLabel` reads from, where "the row for this key" has to mean one row,
 * not both. */
export function preferredRelationTypeByKey<T extends RelationTypeIdentity>(
	types: T[]
): Map<string, T> {
	const byKey = new Map<string, T>();
	for (const type of types) {
		const existing = byKey.get(type.key);
		if (!existing || (existing.universeId === null && type.universeId !== null)) {
			byKey.set(type.key, type);
		}
	}
	return byKey;
}

// ---------------------------------------------------------------------------
// Rung 1's identity function for a relation label.
// ---------------------------------------------------------------------------

/** An articled preposition folded onto its bare form (issue #669). A static, closed table
 * rather than a rule, because that is what it is: Italian has exactly these, they are all
 * function words, and a whole-word lookup cannot reach inside a content word the way a suffix
 * rule can. Deliberately not `nell`/`dell`, the elided forms before a vowel, which arrive as
 * `nell` plus a separate token once punctuation has been collapsed to spaces and are therefore
 * a different edit; no label in either measured corpus uses one. */
const ARTICLED_PREPOSITIONS: Record<string, string> = {
	del: 'di',
	dello: 'di',
	della: 'di',
	dei: 'di',
	degli: 'di',
	delle: 'di',
	dal: 'da',
	dallo: 'da',
	dalla: 'da',
	dai: 'da',
	dagli: 'da',
	dalle: 'da',
	nel: 'in',
	nello: 'in',
	nella: 'in',
	nei: 'in',
	negli: 'in',
	nelle: 'in',
	al: 'a',
	allo: 'a',
	alla: 'a',
	ai: 'a',
	agli: 'a',
	alle: 'a',
	sul: 'su',
	sullo: 'su',
	sulla: 'su',
	sui: 'su',
	sugli: 'su',
	sulle: 'su',
	col: 'con',
	coi: 'con'
};

/** The bare prepositions an Italian relation label puts immediately after a participle:
 * "fondata **da**", "situata **in**", "ambientata **a**". This is the lookahead that keeps the
 * gender rule below off English, and it is the whole reason the rule is safe unlocalised. */
const ITALIAN_PREPOSITIONS: Record<string, true> = {
	da: true,
	di: true,
	in: true,
	a: true,
	su: true,
	con: true,
	per: true,
	tra: true,
	fra: true
};

/** The leading copulas rule 2 strips (issue #689), and the whole list rather than a
 * sample of it: the third person of `essere` and of `to be`, present tense, singular and plural.
 * That is what a relation label written as a sentence fragment uses ("è sindaco di", "is part
 * of"), and it is a closed set because a copula is a closed-class word. `è` arrives here as `e`,
 * since the caller folds diacritics before this runs, so this entry also strips the conjunction
 * "and"; that is deliberate and cheap, because a relation label that opens with "and" is a
 * fragment of a longer phrase whose relation is the rest of it, and because an Italian who types
 * `e sindaco di` for `è sindaco di` gets the same collapse as one who types the accent.
 *
 * **What is deliberately not here, since a leading strip is the widest edit in this file.**
 * `has`/`have`/`ha`/`hanno`, which are not copulas: `has member` is `member_of`'s shipped English
 * inverse label and `ha come membro` its Italian one, so they are the one place a leading strip
 * could move a catalogue string, and the measurement says they buy nothing anyway (stripping them
 * collapses the same 8 questions on the recorded notebook as leaving them out, and folds
 * `ha partecipato a` and `has secret passage to` onto labels nothing else reaches). Past and
 * first/second-person forms are out for the reason `-sta` is: `era` and `sei` are homographs of
 * an English noun and of the Italian for "six", and no label in either corpus uses one. */
const LEADING_COPULAS: Record<string, true> = {
	is: true,
	are: true,
	e: true,
	sono: true
};

/** The copula rule's anchor: what has to appear in the remainder before the copula comes off.
 * Deliberately a different set from `ITALIAN_PREPOSITIONS` above rather than a widening of it,
 * because the gender rule's safety on English depends on `of` and `with` *not* being in its
 * lookahead ("errata of", "vendetta with"), while this rule's whole point is to reach `is part
 * of`. The Italian nine come from #669; the English six are the ones the shipped catalogue and
 * the two measured corpora's labels actually use (`of` in five catalogue labels, `by` in five,
 * plus `for`, `with`, `to` and `at` from the notebooks). An English shape whose preposition is
 * not one of these, `is based on` or `is known as`, does not fold: that is a missed collapse
 * rather than a wrong one, which is the cheap direction to be wrong in, and the set grows when a
 * corpus shows one. */
const RELATION_PREPOSITIONS: Record<string, true> = {
	...ITALIAN_PREPOSITIONS,
	of: true,
	by: true,
	for: true,
	with: true,
	to: true,
	at: true
};

/** The passive-agent marker, and the whole of it: `by` in English, `da` in Italian (issue #697).
 * A participle standing immediately before one of these is the passive half of a relation, and
 * the participle is where the direction lives: `employed by` against `employs`, `commanded by`
 * against `commands`. Five of the ten shipped types name their inverse exactly that way
 * (`employed by`, `owned by`, `commanded by`, `protected by`, `appointed by`), so once rule 4
 * takes the `-ed` off, each one is its forward label's stem plus one function word, and since
 * #690 that stemmed text is what rung 2 embeds rather than what a GM wrote. #628 is what a merge
 * in the wrong direction costs, and a direction error is weighted 2x in #637's cost model.
 *
 * **What the rule is worth, measured on the real model rather than argued** (5 runs on
 * `alibaba/qwen3-embedding-4b`, worst spread 0.0018; every number is a cosine between two
 * normalised labels). It moves the inverse label towards the pairs it should win and away from
 * the ones it should not:
 *
 * | cell | before | after |
 * | --- | --- | --- |
 * | `works for` / `employed by` (a true inverse) | 0.7573 | **0.7759** |
 * | `guidato da` / `commanded by` (a true inverse) | 0.6537 | **0.7237** |
 * | `hires` / `employed by` (a distractor on a `same` pair) | 0.8498 | **0.7537** |
 * | `guards` / `protected by` (a distractor on a `same` pair) | 0.8011 | **0.7714** |
 *
 * It does **not** turn `works for` around: `work for` against `employ` stays 0.8206, so the pair
 * is still read forward, by 0.0447 rather than by the 0.0634 it was. Nothing at or above 0.84
 * ever saw it, and the floor that leaves under `SEMANTIC_REUSE_THRESHOLD` is recorded beside the
 * constant. What the rule buys is the margin in the table above, and the property that a shipped
 * type's direction no longer rests on one function word after this function has run, which
 * `relation-catalogue.test.ts` asserts over all ten types rather than over these five labels.
 *
 * **Two entries rather than `RELATION_PREPOSITIONS`, and the label population is why.** Over the
 * 289 distinct labels in the two recorded corpora plus the shipped catalogue, this set changes
 * the normalisation of eight, every one of them a passive with an agent (the five catalogue
 * inverses plus `visited by`, `trusted by` and `is influenced by`), and it collapses no group
 * that did not already collapse and splits none that did: the partition of those 289 labels is
 * identical before and after. Widening to every preposition additionally moves `located in`,
 * `mentioned in` and `associated with`. The first is a shipped *forward* label whose inverse is
 * `contains`, so `in` carries no direction there, and the third is symmetric; so the wide set
 * edits a shipped string for a direction it cannot name, which is the expensive way to be wrong
 * under L1. The residue that leaves is `mentions` against `mentioned in` in the English corpus,
 * which is the same shape with a locative: they are both proposed labels for a type the
 * catalogue does not have, so rung 2 never scores one against the other, and the set grows when
 * a corpus shows a case that is not that.
 *
 * `da` changes nothing on that population, because an Italian passive marks itself on the
 * participle (`protetto`, `nominato`) rather than with `-ed`, and rule 3 already owns that
 * shape. It is here so the rule is the marker rather than the English half of the marker, and
 * because its presence is what makes the order against rule 3 a decision rather than an
 * accident: `protetta da` has to keep folding onto `protetto da`, which is a rung-1 match #686
 * measured at 0.9857, so this guard suppresses rule 4 alone and never rule 3. */
const PASSIVE_AGENT_MARKERS: Record<string, true> = {
	by: true,
	da: true
};

/** The four participle terminations that actually occur in the two measured corpora: the three
 * regular conjugations (`-ata` fondata, `-ita` costruita, `-uta` venduta) plus the commonest
 * irregular shape (`-tta` protetta, distrutta). `-sta` and `-sa` are deliberately absent: they
 * are real Italian participle endings and neither corpus contains one, so including them would
 * widen the rule for no measured gain. */
const FEMININE_PARTICIPLE_ENDINGS = ['ata', 'ita', 'uta', 'tta'];

/** Six letters, so `data` and `via` cannot reach the rule at all. It also costs the two
 * five-letter participles `fatta` and `nata`, which is a real loss and the right trade: an
 * English label ending in `-a` is a live possibility in every world, and neither of those two
 * appears as a relation label in either corpus. */
const MIN_PARTICIPLE_LENGTH = 6;

/**
 * Lowercases, strips diacritics and collapses anything that is not a letter or digit to
 * single spaces - the same first move `packages/import/src/matching.ts`'s
 * `normalizeForMatching` makes for entity names, for the same reason (issue #36/#37: cheap,
 * free, and it is what makes "Employs" / "employs," / "employs" the same string). Then four
 * deliberately narrow morphology rules on top, since a *label* additionally needs "employs" /
 * "employ" / "employed" to collapse - the exact three-way example the epic names - which a
 * name-matching normaliser has no reason to do.
 *
 * This is not a stemmer for any language and is not meant to be one. Two labels that normalise
 * to one string are one question, both to rung 1 (`resolveRelationType`) and to the vocabulary
 * dedupe key (`packages/db`'s `dedupKeyFor`), and under decision L1 a `key` that gets created
 * is permanent, so every rule here is sized to the collapses that were measured rather than to
 * the ones a lemmatiser would find.
 *
 * **Issues #669 and #689: three of the four rules are morphology rather than punctuation, and
 * none of them is switched on by locale.** A world's labels can be in any language and a real
 * notebook mixes them, so the rules have to be safe on English input rather than gated on a
 * setting. What makes that possible is that each one is anchored on *function words*, which are
 * closed sets, rather than on a suffix alone:
 *
 * 1. An articled preposition folds onto its bare preposition, so `nominato dal` reads as
 *    `nominato da` and `situato nella` as `situato in`. Whole-word table.
 * 2. A leading copula comes off, so `è sindaco di` reads as `sindaco di` and `is part of` as
 *    `part of`, but *only* when what is left still contains one of the prepositions in
 *    `RELATION_PREPOSITIONS` and something that is not a preposition. That anchor is what keeps
 *    the rule off `has member`, and more to the point it is what stops the rule producing a
 *    `key` made of nothing but a function word: without it `is in` normalises to `in`, and under
 *    L1 that string is then permanently the identity of whatever else lands on it.
 * 3. A feminine participle folds onto its masculine form, but *only* immediately before one of
 *    the bare Italian prepositions, so `fondata da` reads as `fondato da` while English `errata
 *    of` and `vendetta with` are left alone: `of` and `with` are not Italian prepositions. `data`
 *    and `via` are below the length floor and cannot reach the rule under any following word.
 * 4. The English inflection stripper, with its own long-word guards so a short function word
 *    ending in "s"/"ed" ("as", "of", "is") survives, and with one anchor of its own (#697): a
 *    participle keeps its `-ed` when the next word is a passive-agent marker, so `employed by`
 *    stays `employed by` while a bare `employed` still folds onto `employ`. That morpheme is the
 *    whole direction signal of five shipped inverse labels, and since #690 the stemmed text is
 *    what rung 2 embeds.
 *
 * Rule 2 runs after rule 1 so its anchor sees a bare preposition (`è sindaco del`), and before
 * rule 3 so a copula does not hide an agreement edit behind it (`è situata a` has to reach
 * `situato a`). Rule 3 runs before rule 4 and is **not** suppressed by rule 4's marker, which is
 * the one ordering that is load-bearing rather than incidental: `da` is a passive-agent marker
 * and `protetta da` is a gender edit sitting in front of one, so a guard that skipped all
 * morphology before a marker would leave `protetta da` and `protetto da` two questions and undo
 * #686's measured rung-1 match. Only the `-ed` strip is suppressed.
 *
 * What rule 2 buys, measured rather than assumed: on its own it collapses one question of the
 * recorded notebook's 122, covering 4 relations (`è sindaco di` onto `sindaco di`), and it turns
 * 22 of the catalogue's 36 distinct strings into rung-1 matches through their copula form, in
 * both locales: `is part of` onto `part of`, `is located in` onto `located in`, `is owned by`
 * onto `owned by`, `è parte di` onto `parte di`, `è protetto da` onto `protetto da`. The active
 * forms (`is commands`, `è protegge`) do not fold, which is right, since they are not a copula
 * construction in the first place.
 *
 * The residue, stated rather than hidden. An English label whose word ends in one of the four
 * terminations *and* is followed by `in` or `a` does fold, `strata in` being the plausible one.
 * A hyphenated leading initial tokenises to a bare letter, so `e-commerce partner of` folds onto
 * `commerce partner of`. And `is a member of` keeps its article, because stripping one is not a
 * copula rule and no corpus asked for it. Each is one collapse rather than a mangling, and the
 * alternative in every case is a rule a mixed-language notebook defeats. No rule but the English
 * stripper touches a shipped catalogue string, in either locale, and no shipped type's forward
 * and inverse labels normalise to strings that differ only in function words, which is asserted
 * rather than asserted-in-prose (`relation-catalogue.test.ts`).
 */
export function normalizeRelationLabel(raw: string): string {
	const normalized = raw
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
	if (normalized.length === 0) return normalized;
	// Rule 1 first, so rules 2 and 3 see the bare preposition: `fondata dalla` has to read as
	// `fondato da`, which needs `dalla` to already be `da` when the participle is examined, and
	// `è sindaco del` needs the same before the copula's anchor is looked for.
	const folded = normalized.split(' ').map((word) => ARTICLED_PREPOSITIONS[word] ?? word);
	const words = withoutLeadingCopula(folded);
	return words
		.map((word, index) => {
			const next = words[index + 1] ?? '';
			// Rule 3 first and unconditionally, then rule 4 with the marker as its anchor: see the
			// ordering paragraph above, `protetta da` is the case that makes the difference.
			const agreed = ITALIAN_PREPOSITIONS[next] === true ? masculineParticiple(word) : word;
			return stemWord(agreed, next);
		})
		.join(' ');
}

/** Rule 2's body. Returns `words` itself when the rule does not fire, so the common case
 * allocates nothing: a label that does not open with a copula is every label in both corpora but
 * fifteen. The two-word floor is what keeps a one-word label from normalising to the empty
 * string, and the "something that is not a preposition" half of the anchor is what keeps `is in`
 * from normalising to `in`. */
function withoutLeadingCopula(words: string[]): string[] {
	if (words.length < 2 || LEADING_COPULAS[words[0]!] !== true) return words;
	let preposition = false;
	let content = false;
	for (let i = 1; i < words.length; i++) {
		if (RELATION_PREPOSITIONS[words[i]!] === true) preposition = true;
		else content = true;
	}
	return preposition && content ? words.slice(1) : words;
}

/** Rule 3's body: only ever called on a word the caller has established is followed by an
 * Italian preposition. */
function masculineParticiple(word: string): string {
	if (word.length < MIN_PARTICIPLE_LENGTH) return word;
	for (const ending of FEMININE_PARTICIPLE_ENDINGS) {
		if (word.endsWith(ending)) return `${word.slice(0, -1)}o`;
	}
	return word;
}

/** Rule 4, the English inflection stripper, unchanged since #197 but for `next` (#697). The
 * length checks before stripping "s"/"ed"/"ing" are what keep it off a short function word that
 * happens to end the same way; the `PASSIVE_AGENT_MARKERS` check is what keeps it off a
 * participle whose `-ed` is the direction of the relation. `next` is the following word, or the
 * empty string at the end of the label, which is in no set here. */
function stemWord(word: string, next: string): string {
	if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
	if (word.length > 4 && word.endsWith('ed')) {
		return PASSIVE_AGENT_MARKERS[next] === true ? word : word.slice(0, -2);
	}
	if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
	return word;
}
