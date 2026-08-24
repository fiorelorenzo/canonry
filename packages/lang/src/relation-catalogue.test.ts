/**
 * `normalizeRelationLabel`'s own cases. The first three describes came here from
 * `packages/copilot/src/relation-types.test.ts` with the function in issue #669; the rest are
 * that issue's two Italian rules and, more importantly, the things they must not do.
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

describe('the shipped catalogue is unmoved by both rules (issue #669)', () => {
	// The strongest available guard. Both new rules are additions to a function that decides
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
			// articled preposition or a feminine participle, so the only rule that may touch one is
			// the English stripper it has always been subject to.
			const englishStripperOnly = label
				.split(' ')
				.map((word) => {
					if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
					if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
					if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
						return word.slice(0, -1);
					}
					return word;
				})
				.join(' ');
			expect(normalizeRelationLabel(label), label).toBe(englishStripperOnly);
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
