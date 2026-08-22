/**
 * Issue #572, guardrail 5 and SPEC.md §15's "no opaque credits": the plan page may not
 * introduce a charge already made as a forward-looking estimate.
 *
 * The defect was one sentence for every trigger but `save`: "Est. 4.00 credits to generate
 * diffs" ("Stima: 4,00 crediti per generare le differenze"), painted over an audit plan
 * whose flags `runAudit` drafted and charged the moment it found them. Wrong twice, since
 * that trigger has no diff-generation step ahead of it and nothing left to estimate. #508
 * made the figure itself honest, what the still-open flags cost; the words around it stayed
 * a promise about a step that does not exist.
 *
 * Three kinds of proof, because each one alone lets the defect back in.
 *
 * The mapping is total over `proposal_trigger`, read off the enum itself rather than off a
 * list retyped here, so a seventh trigger fails this file as well as the compiler and cannot
 * quietly inherit whichever sentence happens to be first.
 *
 * The catalogues are read per trigger, in both locales: no line that carries an
 * already-spent figure may hedge it, and `save`'s own line stays a hedge, because it is the
 * one trigger where an estimate is the truth.
 *
 * And the last is structural, reading the markup the same way
 * `$lib/ask/no-sources-disclosure.test.ts` does and for the same reason: which sentence a
 * plan gets is decided by which branch of a Svelte `{#if}` it sits in, and
 * `pnpm --filter web test` is vitest with a node environment only (`vite.config.ts` declares
 * one project, `server`), so there is no rendered component to assert against. It checks
 * that the estimate keys live only in the propagation branch. That is the half that fails on
 * the plausible bug: an audit plan's figure hoisted back under propagation's wording.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it as test } from 'vitest';
import { proposalTriggerEnum } from '@canonry/db/schema';
import { en } from '$lib/i18n/en.js';
import { it as itMessages } from '$lib/i18n/it.js';
import { PLAN_CREDITS_LINE } from './creditsLine.js';

/** Words that promise a spend rather than report one, in both locales. "Est."/"Stima" is
 * the label the defect wore; "to generate", "per generare" and propagation's own shorter
 * "da generare" are the step it claimed. */
const HEDGES = [
	/\best\.\s/i,
	/estimat/i,
	/\bstima/i,
	/\bprevist/i,
	/to generate/i,
	/per generare/i,
	/da generare/i
];

/** Words that say the money is gone. A line without one of these is not saying what these
 * triggers need said, however carefully it avoids the hedges above. */
const ALREADY_SPENT = [/already spent/i, /già spes/i];

const CATALOGUES = [
	['en', en],
	['it', itMessages]
] as const;

describe('the plan page credits line, per trigger (#572)', () => {
	test('every proposal_trigger has a line, and only propagation reads the estimate', () => {
		expect(Object.keys(PLAN_CREDITS_LINE).sort()).toEqual(
			[...proposalTriggerEnum.enumValues].sort()
		);

		const perDiff = Object.entries(PLAN_CREDITS_LINE)
			.filter(([, line]) => line.kind === 'perDiff')
			.map(([trigger]) => trigger);
		expect(perDiff).toEqual(['save']);
	});

	for (const [locale, catalogue] of CATALOGUES) {
		const checklist = catalogue.proposals.checklist;

		for (const [trigger, line] of Object.entries(PLAN_CREDITS_LINE)) {
			if (line.kind !== 'spent') continue;

			test(`${locale}: the ${trigger} line reads as a charge already made`, () => {
				// Both plural forms, because the singular is where a hand-written "credit to
				// generate" would survive a rewrite of the plural.
				for (const credits of [1, 4]) {
					const { prefix, suffix } = checklist.spentCredits[line.trigger](credits);
					const sentence = `${prefix}${credits}${suffix}`;
					for (const hedge of HEDGES) expect(sentence).not.toMatch(hedge);
					expect(ALREADY_SPENT.some((claim) => claim.test(sentence))).toBe(true);
				}
			});
		}

		for (const [trigger, line] of Object.entries(PLAN_CREDITS_LINE)) {
			if (line.kind !== 'chargedElsewhere') continue;

			test(`${locale}: the ${trigger} line names the charge and shows no figure`, () => {
				const sentence = checklist.chargedElsewhere[line.trigger];
				for (const hedge of HEDGES) expect(sentence).not.toMatch(hedge);
				expect(ALREADY_SPENT.some((claim) => claim.test(sentence))).toBe(true);
				// A plan priced per document or per action has a stored figure of zero, so the
				// line carries no number at all rather than a bold zero.
				expect(sentence).not.toMatch(/\d/);
			});
		}

		test(`${locale}: propagation's own line stays an estimate, because there it is one`, () => {
			const toGenerate = checklist.toGenerate(3, '1');
			const sentence = `${toGenerate.prefix}3${toGenerate.suffix}`;
			expect(HEDGES.some((hedge) => hedge.test(sentence))).toBe(true);
		});
	}

	test('the checklist reads the estimate keys only in the propagation branch', () => {
		const markup = readFileSync(
			fileURLToPath(new URL('../components/proposals/PlanChecklist.svelte', import.meta.url)),
			'utf-8'
		);

		const opensAt = markup.indexOf("{#if pricing.kind === 'perDiff'}");
		expect(opensAt, 'a branch on whether this plan still has diffs to generate').toBeGreaterThan(0);
		const spentAt = markup.indexOf("{:else if pricing.kind === 'spent'}", opensAt);
		expect(spentAt, 'a branch for a figure already spent').toBeGreaterThan(opensAt);

		const propagation = markup.slice(opensAt, spentAt);
		const rest = markup.slice(spentAt);

		expect(propagation).toContain('toGenerate');
		expect(propagation).not.toContain('spentCredits');
		expect(rest).toContain('spentCredits');
		expect(rest).toContain('chargedElsewhere');
		expect(rest).not.toContain('t.toGenerate');
	});
});
