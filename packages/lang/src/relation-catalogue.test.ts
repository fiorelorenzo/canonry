/**
 * `normalizeRelationLabel`'s own cases. The first three describes came here from
 * `packages/copilot/src/relation-types.test.ts` with the function in issue #669; the rest are
 * that issue's two Italian rules, #689's leading copula, and, more importantly, the things they
 * must not do.
 *
 * Two labels that normalise to one string are one question, both to `resolveRelationType`'s
 * rung 1 and to `packages/db`'s vocabulary dedupe key, and under decision L1 the `key` a
 * question creates on accept is permanent. So a rule here is only worth having if it cannot
 * collapse two labels that mean different things, and the tests below are weighted towards
 * proving that rather than towards proving the collapses.
 */
import { describe, expect, it } from 'vitest';
import {
	normalizeRelationLabel,
	RELATION_TYPE_CATALOGUE,
	relationTypeMatchCandidates
} from './relation-catalogue.js';
import { LOCALES } from './locale.js';

describe('normalizeRelationLabel', () => {
	it('collapses case, punctuation and whitespace', () => {
		expect(normalizeRelationLabel('  Employs, ')).toBe(normalizeRelationLabel('employs'));
	});

	it("collapses the epic's own three-way morphology example", () => {
		const employ = normalizeRelationLabel('employ');
		const employs = normalizeRelationLabel('employs');
		const employed = normalizeRelationLabel('employed');
		expect(employ).toBe(employs);
		expect(employ).toBe(employed);
	});

	it('never mangles a short function word that happens to end in "s"/"ed"', () => {
		expect(normalizeRelationLabel('as')).toBe('as');
		expect(normalizeRelationLabel('of')).toBe('of');
	});
});

describe('Italian gender agreement (issue #669)', () => {
	it('collapses the four pairs the recorded notebook actually produced', () => {
		// Every one of these is two `relation_type_new` questions on `main`, and the relation
		// counts behind them are 11+2, 2+1, 2+1 and 1+1 respectively.
		for (const [feminine, masculine] of [
			['situata in', 'situato in'],
			['ambientata a', 'ambientato a'],
			['situata a', 'situato a'],
			['fondata da', 'fondato da']
		]) {
			expect(normalizeRelationLabel(feminine!), `${feminine} vs ${masculine}`).toBe(
				normalizeRelationLabel(masculine!)
			);
		}
	});

	it('collapses the irregular -tta participles, which is what reaches the catalogue', () => {
		// `protetto da` is `protects`'s own Italian inverse label, so this pair is the difference
		// between a rung-2 embedding call and a rung-1 exact match. #637 measured it at 0.9857.
		expect(normalizeRelationLabel('protetta da')).toBe(normalizeRelationLabel('protetto da'));
		expect(normalizeRelationLabel('distrutta da')).toBe(normalizeRelationLabel('distrutto da'));
	});

	it('collapses the three regular conjugations', () => {
		expect(normalizeRelationLabel('creata da')).toBe(normalizeRelationLabel('creato da'));
		expect(normalizeRelationLabel('costruita da')).toBe(normalizeRelationLabel('costruito da'));
		expect(normalizeRelationLabel('venduta a')).toBe(normalizeRelationLabel('venduto a'));
	});

	it('does not touch a feminine ending that no Italian preposition follows', () => {
		// The lookahead is the whole safety mechanism: without a following preposition the rule
		// does not fire, so a bare noun is never rewritten.
		expect(normalizeRelationLabel('fondata')).toBe('fondata');
		expect(normalizeRelationLabel('situata presso il porto')).toBe('situata presso il porto');
	});

	it('does not collapse two Italian labels that differ by more than agreement', () => {
		expect(normalizeRelationLabel('fondata da')).not.toBe(normalizeRelationLabel('fondata in'));
		expect(normalizeRelationLabel('situata in')).not.toBe(normalizeRelationLabel('situata a'));
		expect(normalizeRelationLabel('protetta da')).not.toBe(normalizeRelationLabel('protetta in'));
	});
});

describe('the rule is safe on English rather than switched on by locale (issue #669)', () => {
	it('leaves "data" and "via" alone in every position, including before an Italian preposition', () => {
		// The two shapes #669 names. Both are under the six-letter floor, so no following word can
		// bring them into the rule. `data in` and `data a` are the dangerous pair: `in` and `a`
		// are Italian prepositions, so the lookahead fires and only the length floor saves them.
		// Asserted per word rather than per label, because `reached via` legitimately becomes
		// `reach via` through the English stripper this rule did not touch.
		for (const word of ['data', 'via']) {
			expect(normalizeRelationLabel(word), word).toBe(word);
			for (const follower of ['of', 'in', 'a', 'da', 'di', 'with']) {
				expect(normalizeRelationLabel(`${word} ${follower}`), `${word} ${follower}`).toBe(
					`${word} ${follower}`
				);
			}
			expect(normalizeRelationLabel(`has ${word}`), `has ${word}`).toBe(`has ${word}`);
		}
	});

	it('leaves an English word ending in a participle termination alone when an English preposition follows', () => {
		// `of` and `with` are not Italian prepositions, which is what the lookahead buys: a
		// suffix-only rule would rewrite all four of these.
		expect(normalizeRelationLabel('errata of')).toBe('errata of');
		expect(normalizeRelationLabel('vendetta with')).toBe('vendetta with');
		expect(normalizeRelationLabel('sonata of')).toBe('sonata of');
		expect(normalizeRelationLabel('regatta of')).toBe('regatta of');
	});

	it('leaves an ordinary English label untouched', () => {
		for (const label of ['member of', 'part of', 'subpage of', 'mentions', 'parent of']) {
			expect(normalizeRelationLabel(label), label).not.toContain('o o');
		}
		expect(normalizeRelationLabel('member of')).toBe('member of');
		expect(normalizeRelationLabel('subpage of')).toBe('subpage of');
	});
});

describe('Italian articled prepositions (issue #669)', () => {
	it('folds an articled preposition onto its bare form', () => {
		expect(normalizeRelationLabel('situato nel')).toBe(normalizeRelationLabel('situato in'));
		expect(normalizeRelationLabel('situato nella')).toBe(normalizeRelationLabel('situato in'));
		expect(normalizeRelationLabel('sede della')).toBe(normalizeRelationLabel('sede di'));
		expect(normalizeRelationLabel('nominato dal')).toBe(normalizeRelationLabel('nominato da'));
	});

	it('reaches the catalogue: "nominato dal" becomes appointed\'s own Italian inverse label', () => {
		// One enclitic article from a shipped string, which #637 measured at 0.9585 through rung
		// 2. After this it is a rung-1 match and costs no embedding call at all.
		expect(normalizeRelationLabel('nominato dal')).toBe(
			normalizeRelationLabel(RELATION_TYPE_CATALOGUE.it.appointed!.inverseLabel)
		);
	});

	it('runs before the gender rule, so both edits compose', () => {
		// `fondata dalla` needs `dalla` to already be `da` when the participle is examined.
		expect(normalizeRelationLabel('fondata dalla')).toBe(normalizeRelationLabel('fondato da'));
		expect(normalizeRelationLabel('situata nella')).toBe(normalizeRelationLabel('situato in'));
	});

	it('keeps the bare prepositions distinct from each other', () => {
		// `della` -> `di` and `alla` -> `a` must not meet in the middle.
		expect(normalizeRelationLabel('parte della')).not.toBe(normalizeRelationLabel('parte alla'));
		expect(normalizeRelationLabel('situato nel')).not.toBe(normalizeRelationLabel('situato al'));
	});
});

describe('the leading copula (issue #689)', () => {
	it('collapses the pair the recorded notebook actually produced', () => {
		// `è sindaco di` carries 2 relations and `sindaco di` 2, and they are two
		// `relation_type_new` questions on `main`. This is the whole of what the rule collapses on
		// that corpus: one question of 122, covering 4 relations.
		expect(normalizeRelationLabel('è sindaco di')).toBe(normalizeRelationLabel('sindaco di'));
	});

	it('reaches the catalogue in both locales, which is what makes it worth a rule', () => {
		// #637's `is-part-of-vs-part-of`, described there as the easiest true pair in the set,
		// stops being a rung-2 embedding call and becomes a rung-1 exact match. Its Italian
		// reading is the same edit against the same key.
		expect(normalizeRelationLabel('is part of')).toBe(
			normalizeRelationLabel(RELATION_TYPE_CATALOGUE.en.part_of!.label)
		);
		expect(normalizeRelationLabel('è parte di')).toBe(
			normalizeRelationLabel(RELATION_TYPE_CATALOGUE.it.part_of!.label)
		);
		// And it is not one pair: every catalogue label that is a copula construction in the
		// first place (a participle plus `by`/`da`, or a noun plus `of`/`di`) is now reachable
		// through its copula form, which is 22 of the 36 distinct shipped strings.
		for (const [copula, label] of [
			['is', RELATION_TYPE_CATALOGUE.en.located_in!.label],
			['is', RELATION_TYPE_CATALOGUE.en.owns!.inverseLabel],
			['is', RELATION_TYPE_CATALOGUE.en.protects!.inverseLabel],
			['is', RELATION_TYPE_CATALOGUE.en.parent_of!.inverseLabel],
			['è', RELATION_TYPE_CATALOGUE.it.protects!.inverseLabel],
			['è', RELATION_TYPE_CATALOGUE.it.appointed!.inverseLabel],
			['è', RELATION_TYPE_CATALOGUE.it.member_of!.label]
		]) {
			expect(normalizeRelationLabel(`${copula} ${label}`), `${copula} ${label}`).toBe(
				normalizeRelationLabel(label!)
			);
		}
	});

	it('strips the plural and the Italian forms, not only "is"', () => {
		// `sono attivi a` is a real label from the recorded notebook. `are allies of` is not in
		// either corpus and is here because the rule cannot see the subject's number: a label is
		// not a sentence, so excluding `are` would make the collapse depend on something the
		// input does not carry.
		expect(normalizeRelationLabel('sono attivi a')).toBe(normalizeRelationLabel('attivi a'));
		expect(normalizeRelationLabel('are allies of')).toBe(normalizeRelationLabel('allies of'));
		expect(normalizeRelationLabel('is influenced by')).toBe(
			normalizeRelationLabel('influenced by')
		);
	});

	it('composes with the other two rules rather than hiding them behind the copula', () => {
		// Rule 1 runs first, so the anchor sees `di` rather than `del`; rule 3 runs after, so an
		// agreement edit behind a copula still folds. Both orderings are load-bearing.
		expect(normalizeRelationLabel('è parte del')).toBe(normalizeRelationLabel('parte di'));
		expect(normalizeRelationLabel('è situata a')).toBe(normalizeRelationLabel('situato a'));
		expect(normalizeRelationLabel('è fondata dalla')).toBe(normalizeRelationLabel('fondato da'));
	});
});

describe('the copula rule is anchored rather than a bare leading strip (issue #689)', () => {
	it('leaves "has member" and "ha come membro" alone, because it does not strip "has" at all', () => {
		// The constraint #689 is built around: both are shipped `member_of` inverse labels, and
		// they are the one place a leading strip could move a catalogue string. `has` and `ha` are
		// not copulas and are not in the strip set, so nothing here depends on the anchor holding.
		// Measured on the recorded notebook, adding them collapses the same 8 questions as leaving
		// them out, so the exclusion costs nothing: it only declines to fold `ha partecipato a`
		// and `has secret passage to` onto labels nothing else reaches.
		expect(normalizeRelationLabel('has member')).toBe('has member');
		expect(normalizeRelationLabel('ha come membro')).toBe('ha come membro');
		expect(normalizeRelationLabel('has subpage')).toBe('has subpage');
		expect(normalizeRelationLabel('ha partecipato a')).toBe('ha partecipato a');
		// So `has as member` stays its own label rather than folding onto `has member`. Folding
		// those two together would mean dropping a word from the middle, which is what
		// `ha come membro` is made of, and that moves a catalogue string.
		expect(normalizeRelationLabel('has as member')).toBe('has as member');
	});

	it('never strips a copula down to a function word or to nothing', () => {
		// The anchor's two halves. A one-word label has nothing to strip to, and a remainder made
		// only of prepositions would make `in` the permanent key of whatever else normalises to
		// it, which under L1 is the worst shape a collapse can produce.
		for (const label of ['is', 'are', 'e', 'è', 'sono']) {
			expect(normalizeRelationLabel(label).length, label).toBeGreaterThan(0);
		}
		expect(normalizeRelationLabel('is in')).toBe('is in');
		expect(normalizeRelationLabel('è in')).toBe('e in');
		expect(normalizeRelationLabel('are of')).toBe('are of');
	});

	it('does not fire when the remainder is not shaped like a relation phrase', () => {
		// No preposition, no fold: `is member` is not `member of` and must not become a third
		// string sitting between them.
		expect(normalizeRelationLabel('is member')).toBe('is member');
		expect(normalizeRelationLabel('sono attivi')).toBe('sono attivi');
		// An English preposition the anchor does not list is a missed collapse rather than a wrong
		// one, and this is the assertion that says which direction the set errs in. Asserted as a
		// non-collapse rather than against a literal, because the English stripper still runs and
		// `based` becomes `bas` on both sides.
		expect(normalizeRelationLabel('is based on')).not.toBe(normalizeRelationLabel('based on'));
	});

	it('matches a copula as a whole word, so an English label that merely starts with those letters is safe', () => {
		// The analogue of #669's `data` and `via`: the words a leading strip would eat if it
		// worked on characters instead of tokens. All five are plausible relation labels and none
		// moves.
		for (const label of ['island of', 'issued by', 'estate of', 'era of', 'eastern gate of']) {
			// Word count is exactly the property: the rule drops a token, so if it fired on any of
			// these the label would come back one word shorter. Asserted that way rather than
			// against a literal because the English stripper still runs (`issued` becomes `issu`).
			expect(normalizeRelationLabel(label).split(' ').length, label).toBe(label.split(' ').length);
		}
		expect(normalizeRelationLabel('island of')).toBe('island of');
		// And the residue, pinned rather than described: an article after the copula survives,
		// because stripping one is not a copula rule and no corpus asked for it.
		expect(normalizeRelationLabel('is a member of')).toBe('a member of');
		expect(normalizeRelationLabel('is a member of')).not.toBe(normalizeRelationLabel('member of'));
	});
});

describe('the passive-agent marker keeps a participle whole (issue #697)', () => {
	it('keeps the `-ed` of the five catalogue inverse labels', () => {
		// Each of these is its forward label's stem plus `by` once the stripper has run, so before
		// this rule the whole direction signal was that one function word, and since #690 the
		// stemmed text is what rung 2 embeds.
		expect(normalizeRelationLabel('employed by')).toBe('employed by');
		expect(normalizeRelationLabel('owned by')).toBe('owned by');
		expect(normalizeRelationLabel('commanded by')).toBe('commanded by');
		expect(normalizeRelationLabel('protected by')).toBe('protected by');
		expect(normalizeRelationLabel('appointed by')).toBe('appointed by');
	});

	it("still collapses the epic's three-way example, because a bare participle is not a passive", () => {
		// The collapse #197 asked for is untouched: what the marker guards is a participle standing
		// in front of its agent, not the participle.
		expect(normalizeRelationLabel('employed')).toBe(normalizeRelationLabel('employs'));
		expect(normalizeRelationLabel('appointed')).toBe(normalizeRelationLabel('appoints'));
		expect(normalizeRelationLabel('Commanded By')).toBe(normalizeRelationLabel('commanded by'));
	});

	it('leaves the `-s` and `-ing` branches alone, so only the participle is guarded', () => {
		expect(normalizeRelationLabel('guards by')).toBe('guard by');
		expect(normalizeRelationLabel('guarding by')).toBe('guard by');
	});

	it('is two markers rather than every preposition, so a locative participle still folds', () => {
		// `located in` is a shipped *forward* label whose inverse is `contains`, so `in` carries no
		// direction and widening the set would edit a shipped string for nothing. The cost of that
		// choice is `mentioned in`, which is a real inverse of `mentions` in the English corpus:
		// both are proposed labels for a type the catalogue does not have, so rung 2 never scores
		// one against the other, and the set grows when a corpus shows a case that is not that.
		expect(normalizeRelationLabel('located in')).toBe('locat in');
		expect(normalizeRelationLabel('mentioned in')).toBe('mention in');
		expect(normalizeRelationLabel('associated with')).toBe('associat with');
	});

	it('does not fire on a short word that merely ends in "ed"', () => {
		expect(normalizeRelationLabel('fed by')).toBe('fed by');
		expect(normalizeRelationLabel('bed by')).toBe('bed by');
	});
});

describe('the marker suppresses rule 4 and never rule 3 (issues #669, #697)', () => {
	// The one ordering in this file that is load-bearing rather than incidental. `da` is a
	// passive-agent marker and an Italian gender edit sits in front of one, so a guard written as
	// "skip morphology before a marker" would leave `protetta da` and `protetto da` two questions
	// and undo a rung-1 match #686 measured at 0.9857 on the real model. These cases fail under
	// that reading of the rule and pass under the one that is implemented.
	it('still folds a feminine participle standing before `da`', () => {
		expect(normalizeRelationLabel('protetta da')).toBe('protetto da');
		expect(normalizeRelationLabel('nominata da')).toBe('nominato da');
		expect(normalizeRelationLabel('fondata da')).toBe('fondato da');
	});

	it('still folds the articled form through both rules', () => {
		// Rule 1 turns `dal` into `da`, which is what rule 3's lookahead and rule 4's marker both
		// read, so all three have to agree on one string.
		expect(normalizeRelationLabel('nominato dal')).toBe('nominato da');
		expect(normalizeRelationLabel('nominata dalla')).toBe('nominato da');
		expect(normalizeRelationLabel('protetta dalla')).toBe('protetto da');
	});

	it('keeps an English participle whole in the same position', () => {
		// `appointed da` is not a label anyone writes; it is the case that proves the two rules are
		// reading the same following word and disagreeing about nothing.
		expect(normalizeRelationLabel('appointed da')).toBe('appointed da');
	});
});

describe('the shipped catalogue is unmoved by the morphology rules (issues #669, #689, #697)', () => {
	// The strongest available guard. Every rule here is an addition to a function that decides
	// rung 1, and rung 1 is what makes a shipped locale's label resolve at all (#197). If a
	// catalogue string normalised differently after this change, every existing rung-1 match
	// through it would silently change behaviour, so the assertion is that none does.
	const CATALOGUE_STRINGS = LOCALES.flatMap((locale) =>
		Object.values(RELATION_TYPE_CATALOGUE[locale]).flatMap((entry) => [
			entry.label,
			entry.inverseLabel
		])
	);

	it('normalises every catalogue string to case-and-whitespace only', () => {
		for (const label of CATALOGUE_STRINGS) {
			// Every shipped string is already lower case with single spaces, and none carries an
			// articled preposition, a feminine participle or a leading copula, so the only rule that
			// may touch one is the English stripper it has always been subject to. Spelled out here
			// rather than imported, so that widening a set in the module does not silently widen
			// what this test believes the module is allowed to do. #697's marker is part of the
			// stripper and so part of this model: it is what keeps `employed by` off `employ by`.
			const words = label.split(' ');
			const englishStripperOnly = words
				.map((word, index) => {
					const next = words[index + 1] ?? '';
					if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
					if (word.length > 4 && word.endsWith('ed')) {
						return next === 'by' || next === 'da' ? word : word.slice(0, -2);
					}
					if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
						return word.slice(0, -1);
					}
					return word;
				})
				.join(' ');
			expect(normalizeRelationLabel(label), label).toBe(englishStripperOnly);
		}
	});

	it('leaves no shipped type whose direction survives on a function word alone', () => {
		/**
		 * Issue #697, and the assertion that would have caught it the day #669 landed. It is not
		 * enough that a type's two labels normalise to two strings: `employs` became `employ` and
		 * `employed by` became `employ by`, which are two strings whose whole difference is one
		 * function word, and since #690 that is the text rung 2 embeds. So the property is that
		 * the two normalisations still differ once every function word is dropped from both.
		 *
		 * The function words are spelled out rather than imported for the reason above: this list
		 * is the contract, and a set widened in the module must not widen it here. It is the union
		 * of that module's `RELATION_PREPOSITIONS` and `LEADING_COPULAS`. `has` is deliberately
		 * absent from both, which is why `member of` against `has member` passes on `has`; that is
		 * #689's decision, recorded there, and this test inherits it rather than restating it.
		 */
		const FUNCTION_WORDS: Record<string, true> = {
			da: true,
			di: true,
			in: true,
			a: true,
			su: true,
			con: true,
			per: true,
			tra: true,
			fra: true,
			of: true,
			by: true,
			for: true,
			with: true,
			to: true,
			at: true,
			is: true,
			are: true,
			e: true,
			sono: true
		};
		const contentWords = (label: string): string =>
			normalizeRelationLabel(label)
				.split(' ')
				.filter((word) => FUNCTION_WORDS[word] !== true)
				.join(' ');

		for (const locale of LOCALES) {
			for (const [key, entry] of Object.entries(RELATION_TYPE_CATALOGUE[locale])) {
				// `ally_of` names itself in both directions, which is the relation being symmetric
				// rather than the normaliser losing anything, so there is nothing to assert about it.
				if (entry.label === entry.inverseLabel) continue;
				const where = `${locale}/${key}: "${entry.label}" vs "${entry.inverseLabel}"`;
				expect(normalizeRelationLabel(entry.label), where).not.toBe(
					normalizeRelationLabel(entry.inverseLabel)
				);
				expect(contentWords(entry.label), where).not.toBe(contentWords(entry.inverseLabel));
			}
		}
	});

	it('keeps every distinct catalogue string distinct after normalising', () => {
		// A collapse between two catalogue strings would merge two shipped keys at rung 1, which
		// under L1 is unrecoverable. `contains` appears twice (`located_in`'s inverse and
		// `part_of`'s) and `ally of` / `alleato di` are each their own inverse, so the comparison
		// is over the distinct set.
		const distinct = [...new Set(CATALOGUE_STRINGS)];
		const normalised = distinct.map((label) => normalizeRelationLabel(label));
		expect(new Set(normalised).size).toBe(new Set(distinct).size);
	});

	it('keeps every shipped label matching itself through relationTypeMatchCandidates', () => {
		for (const key of Object.keys(RELATION_TYPE_CATALOGUE.en)) {
			const entry = RELATION_TYPE_CATALOGUE.en[key]!;
			const candidates = relationTypeMatchCandidates({
				key,
				label: entry.label,
				inverseLabel: entry.inverseLabel,
				universeId: null
			});
			for (const candidate of candidates) {
				const hit = candidates.some(
					(other) =>
						other.direction === candidate.direction &&
						normalizeRelationLabel(other.label) === normalizeRelationLabel(candidate.label)
				);
				expect(hit, `${key}: ${candidate.label}`).toBe(true);
			}
		}
	});
});
