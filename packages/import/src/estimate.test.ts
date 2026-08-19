/**
 * Pure-function tests for `estimate.ts` (issue #272) - no database. The DB-backed path
 * (`estimateAveragesForPlaybook`'s historical-average branch) is exercised against a real
 * Postgres in `apps/web/src/lib/server/onboarding.test.ts`, which re-exports this same
 * function under the name callers there already use; duplicating that setup here would
 * test the same code twice for no more confidence.
 */
import { describe, expect, it } from 'vitest';
import {
	budgetCreditsForEstimate,
	deriveJobBudget,
	IMPORT_BUDGET_HEADROOM_MULTIPLIER,
	PLAYBOOK_COLD_START_ESTIMATE
} from './estimate.js';
import { BUILTIN_PLAYBOOK_IDS } from './playbooks.generated.js';

describe('PLAYBOOK_COLD_START_ESTIMATE (issue #272): every shipped playbook, not just onenote', () => {
	it('carries a row for every built-in playbook id', () => {
		for (const id of BUILTIN_PLAYBOOK_IDS) {
			expect(PLAYBOOK_COLD_START_ESTIMATE[id], `missing row for "${id}"`).toBeDefined();
		}
	});

	it('every row is well above the old flat guesses (0.2-0.5 credits/document) that produced #261 and #272', () => {
		for (const id of BUILTIN_PLAYBOOK_IDS) {
			expect(
				PLAYBOOK_COLD_START_ESTIMATE[id]!.avgCreditsPerDocument,
				`"${id}" is still near the old guess`
			).toBeGreaterThan(1);
		}
	});

	it("obsidian lands on exactly onenote's measured number - same stepBudget, same mandatory link-following shape (#272's own \"off by roughly the factor onenote's was\")", () => {
		expect(PLAYBOOK_COLD_START_ESTIMATE.obsidian).toEqual(PLAYBOOK_COLD_START_ESTIMATE.onenote);
	});

	it('a lower-stepBudget playbook (docx/pdf/generic, 40) is cheaper than a higher-stepBudget one (onenote/obsidian, 60), not equal or inverted', () => {
		expect(PLAYBOOK_COLD_START_ESTIMATE.docx!.avgCreditsPerDocument).toBeLessThan(
			PLAYBOOK_COLD_START_ESTIMATE.onenote!.avgCreditsPerDocument
		);
		expect(PLAYBOOK_COLD_START_ESTIMATE.docx).toEqual(PLAYBOOK_COLD_START_ESTIMATE.pdf);
		expect(PLAYBOOK_COLD_START_ESTIMATE.docx).toEqual(PLAYBOOK_COLD_START_ESTIMATE.generic);
	});

	it('the seven constants sit much closer together than the old table (0.2-0.5, a 2.5x spread) despite still varying by stepBudget', () => {
		const values = BUILTIN_PLAYBOOK_IDS.map(
			(id) => PLAYBOOK_COLD_START_ESTIMATE[id]!.avgCreditsPerDocument
		);
		const spread = Math.max(...values) / Math.min(...values);
		expect(spread).toBeLessThan(2);
	});
});

describe('deriveJobBudget / budgetCreditsForEstimate (issue #261 item 3, #272)', () => {
	it('a 3-document onenote-shaped job quotes 9 credits / 1 minute and budgets 54', () => {
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 3);
		expect(estimate.estimatedCredits).toBe(9);
		expect(estimate.estimatedMinutes).toBe(1);
		// The real three-note Obsidian job that motivated the multiplier spent 16.8720 on
		// two of its three documents, so a budget of 18 could not finish it. 54 can.
		expect(budgetCredits).toBe(54);
	});

	it('a 14-document onenote-shaped job quotes 40 credits / 5 minutes and budgets 240', () => {
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 14);
		expect(estimate.estimatedCredits).toBe(40);
		expect(estimate.estimatedMinutes).toBe(5);
		expect(budgetCredits).toBe(240);
	});

	it("a 35-document obsidian-shaped job (issue #272's own question) quotes 99 credits / 12 minutes and budgets 594", () => {
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.obsidian!, 35);
		expect(estimate.estimatedCredits).toBe(99);
		expect(estimate.estimatedMinutes).toBe(12);
		expect(budgetCredits).toBe(594);
	});

	it('budgetCreditsForEstimate always derives from the estimate - never a free-floating number a caller could substitute', () => {
		expect(budgetCreditsForEstimate({ estimatedCredits: 10 })).toBe(
			Math.ceil(10 * IMPORT_BUDGET_HEADROOM_MULTIPLIER)
		);
		expect(budgetCreditsForEstimate({ estimatedCredits: 7 }, 3)).toBe(21);
	});
});
