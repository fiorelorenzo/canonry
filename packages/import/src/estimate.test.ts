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
	IMPORT_TIMEOUT_FLOOR_MS,
	IMPORT_TIMEOUT_HEADROOM_MULTIPLIER,
	PLAYBOOK_COLD_START_ESTIMATE,
	timeoutMsForEstimate,
	UNMEASURED_PLAYBOOK_ESTIMATE
} from './estimate.js';
import { BUILTIN_PLAYBOOK_IDS } from './playbooks.generated.js';

describe('PLAYBOOK_COLD_START_ESTIMATE (issue #272): every shipped playbook, not just onenote', () => {
	const credits = (id: string) => PLAYBOOK_COLD_START_ESTIMATE[id]!.avgCreditsPerDocument;

	it('carries a row for every built-in playbook id', () => {
		for (const id of BUILTIN_PLAYBOOK_IDS) {
			expect(PLAYBOOK_COLD_START_ESTIMATE[id], `missing row for "${id}"`).toBeDefined();
		}
	});

	it('every row is well clear of the old flat guesses (0.2-0.5 credits/document) that produced #261 and #272', () => {
		// This bound was `> 1` until #330 re-derived the table off two real `.mht` jobs, and
		// #606 then measured the other six, which put the whole table between 0.745 and 1.1492.
		// The guard it exists to be is against sliding back to the old guesses, so it tracks
		// the top of that band (0.5) rather than a round number a later calibration happens
		// to clear.
		for (const id of BUILTIN_PLAYBOOK_IDS) {
			expect(
				PLAYBOOK_COLD_START_ESTIMATE[id]!.avgCreditsPerDocument,
				`"${id}" is back in the old guess band`
			).toBeGreaterThan(0.5);
		}
	});

	it('every row quotes at or above what the real job behind it actually spent (issue #606)', () => {
		// The invariant that replaces #330's "every row is onenote scaled by its stepBudget".
		// Each pair below is a real `import_job` measurement: the documents that were imported
		// through the product's own upload path and the credits they billed, pooled per
		// playbook the same way `estimateAveragesForPlaybook` pools real rows. The contract a
		// cold-start row has is that the number the GM consents to covers the work, so a row
		// lowered by a later edit fails here rather than shipping a consent screen that
		// understates. docx passes only because `estimateImportJob` rounds up (4 x 0.7549 is
		// 3.0196 against 3.0197 spent), which is honest: the screen shows whole credits.
		const measured: Record<string, { documents: number; spentCredits: number; seconds: number }> = {
			// #330, two real `.mht` jobs of a real notebook, 479.2s + 952.9s.
			onenote: { documents: 93, spentCredits: 106.8722, seconds: 1432.1 },
			// #606, one job per playbook against the bench corpus unless noted.
			obsidian: { documents: 35, spentCredits: 30.3658, seconds: 814.8 },
			'world-anvil': { documents: 32, spentCredits: 23.8399, seconds: 402.0 },
			kanka: { documents: 7, spentCredits: 6.7393, seconds: 123.2 },
			// four single-file uploads, one document each
			docx: { documents: 4, spentCredits: 3.0197, seconds: 50.0 },
			// two single-file uploads
			pdf: { documents: 2, spentCredits: 1.9397, seconds: 50.5 },
			// three jobs: two generic exports of 5, plus a zip of two `.docx`
			generic: { documents: 12, spentCredits: 9.6364, seconds: 186.4 }
		};

		for (const id of BUILTIN_PLAYBOOK_IDS) {
			const job = measured[id];
			expect(job, `"${id}" has no recorded measurement`).toBeDefined();
			const { estimate, timeoutMs } = deriveJobBudget(
				PLAYBOOK_COLD_START_ESTIMATE[id]!,
				job!.documents
			);
			expect(estimate.estimatedCredits, `"${id}" quote`).toBeGreaterThanOrEqual(job!.spentCredits);
			// And the wall clock it derives covers the run it came from, which is the failure
			// `timeoutMsForEstimate` exists for: a job killed one minute after its own estimate.
			expect(timeoutMs, `"${id}" timeout`).toBeGreaterThan(job!.seconds * 1000);
		}
	});

	it('no row is another row scaled by its stepBudget any more, so playbooks sharing a budget differ (issue #606)', () => {
		// This is the regression guard on #606's own finding. Until #606 the six unmeasured
		// rows were onenote's figure times their own `stepBudget` over 60, so obsidian equalled
		// onenote exactly and the other pairs collapsed onto two values. Six real measurements
		// say a step budget predicts almost nothing: obsidian and onenote share 60 and differ
		// by 1.32x, world-anvil and kanka share 50 and differ by 1.29x, and among the three
		// that share 40 the spread is 1.29x. Reinstating any formula makes these equal again.

		expect(credits('obsidian')).not.toBe(credits('onenote'));
		expect(credits('world-anvil')).not.toBe(credits('kanka'));
		expect(credits('docx')).not.toBe(credits('pdf'));
		expect(credits('docx')).not.toBe(credits('generic'));
	});

	it('a lower stepBudget is not a cheaper playbook: pdf (40) costs more per document than obsidian (60)', () => {
		// The measured inversion, kept as a test because it is the whole reason the formula
		// went. pdf was the row the old scaling put furthest out, inferred at 0.7661 against a
		// measured 0.9699, and obsidian was inferred at 1.1492 against a measured 0.8676. A
		// single PDF is one big document that the loop reads in full; an Obsidian note is small
		// and most of them find little to propose.
		expect(credits('pdf')).toBeGreaterThan(credits('obsidian'));
	});

	it('the unmeasured-playbook fallback is at least as expensive as every measured row (issue #606)', () => {
		// #272's rule made checkable: for a playbook nobody has run there is no evidence it is
		// cheaper than the dearest one we have measured, and guessing low costs a job that
		// cannot finish. Before #606 this fallback was the cheapest inferred row.
		for (const id of BUILTIN_PLAYBOOK_IDS) {
			const row = PLAYBOOK_COLD_START_ESTIMATE[id]!;
			expect(
				UNMEASURED_PLAYBOOK_ESTIMATE.avgCreditsPerDocument,
				`cheaper than "${id}"`
			).toBeGreaterThanOrEqual(row.avgCreditsPerDocument);
			expect(
				UNMEASURED_PLAYBOOK_ESTIMATE.avgSecondsPerDocument,
				`faster than "${id}"`
			).toBeGreaterThanOrEqual(row.avgSecondsPerDocument);
		}
	});

	it('the seven constants sit much closer together than the old table (0.2-0.5, a 2.5x spread)', () => {
		// 0.745 (world-anvil) to 1.1492 (onenote) after #606, a 1.54x spread across seven
		// measurements of six different formats, against the 2.5x spread of the guesses.
		const values = BUILTIN_PLAYBOOK_IDS.map(
			(id) => PLAYBOOK_COLD_START_ESTIMATE[id]!.avgCreditsPerDocument
		);
		const spread = Math.max(...values) / Math.min(...values);
		expect(spread).toBeLessThan(2);
	});
});

describe('deriveJobBudget / budgetCreditsForEstimate (issue #261 item 3, #272)', () => {
	it('a 3-document onenote-shaped job quotes 4 credits / 1 minute and budgets 24', () => {
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 3);
		expect(estimate.estimatedCredits).toBe(4);
		expect(estimate.estimatedMinutes).toBe(1);
		// The real three-note Obsidian job that motivated the multiplier spent 16.8720 on two
		// of its three documents, so a budget of 18 could not finish it. This was 54 before
		// #330 and is 24 after. [INFERENCE] Those 16.8720 credits were billed before #313
		// priced cached input; repricing them at the 50% drop #330 measured on its own two
		// jobs puts that pair near 8.4, so 24 still clears the whole three-note job. Nothing
		// re-ran it, so that is arithmetic on an old row rather than a measurement.
		expect(budgetCredits).toBe(24);
	});

	it('a 14-document onenote-shaped job quotes 17 credits / 5 minutes and budgets 102', () => {
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 14);
		expect(estimate.estimatedCredits).toBe(17);
		expect(estimate.estimatedMinutes).toBe(5);
		expect(budgetCredits).toBe(102);
	});

	it("quotes the real 70-page notebook above what it actually spent (issue #330's own job)", () => {
		// The measurement behind the constant: 70 documents, 75.8718 credits, read off
		// `import_job`. The number the GM consents to has to cover that, which is the property
		// the pre-#330 constant had by being 2.5x too high and this one has to hold honestly.
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 70);
		expect(estimate.estimatedCredits).toBe(81);
		expect(estimate.estimatedCredits).toBeGreaterThan(75.8718);
		expect(budgetCredits).toBe(486);
	});

	it("the real 35-document obsidian vault (issue #272's own question, measured in #606) quotes 31 credits / 14 minutes and budgets 186", () => {
		// This was 41 / 12 / 246 while obsidian carried onenote's number. #606 imported the
		// corpus's own 35-document vault and it billed 30.3658, so the quote covers it by 0.63
		// of a credit and the budget by six times that.
		const { estimate, budgetCredits } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.obsidian!, 35);
		expect(estimate.estimatedCredits).toBe(31);
		expect(estimate.estimatedCredits).toBeGreaterThan(30.3658);
		expect(estimate.estimatedMinutes).toBe(14);
		expect(budgetCredits).toBe(186);
	});

	it('budgetCreditsForEstimate always derives from the estimate - never a free-floating number a caller could substitute', () => {
		expect(budgetCreditsForEstimate({ estimatedCredits: 10 })).toBe(
			Math.ceil(10 * IMPORT_BUDGET_HEADROOM_MULTIPLIER)
		);
		expect(budgetCreditsForEstimate({ estimatedCredits: 7 }, 3)).toBe(21);
	});
});

describe('timeoutMsForEstimate: the wall clock a job is allowed, derived not fixed', () => {
	it('gives the fourteen-document job that used to be cancelled mid-step room to finish', () => {
		// The real failure: quoted "about four minutes" on the estimate screen, killed at
		// exactly 300 seconds with 71 proposals emitted and 44.20 of 240 credits spent.
		const { estimate, timeoutMs } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 14);
		expect(estimate.estimatedMinutes).toBe(5);
		expect(timeoutMs).toBe(15 * 60_000);
		expect(timeoutMs).toBeGreaterThan(IMPORT_TIMEOUT_FLOOR_MS);
	});

	it('never drops below the floor a small job already had', () => {
		const { estimate, timeoutMs } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.onenote!, 3);
		expect(estimate.estimatedMinutes).toBe(1);
		// Three times one minute is under the floor, so the floor wins. Measured runs of
		// this size took 44 seconds (OneNote) and 125 (Obsidian), well inside it.
		expect(timeoutMs).toBe(IMPORT_TIMEOUT_FLOOR_MS);
	});

	it('scales with the estimate for a large job rather than staying flat', () => {
		const { estimate, timeoutMs } = deriveJobBudget(PLAYBOOK_COLD_START_ESTIMATE.obsidian!, 35);
		expect(estimate.estimatedMinutes).toBe(14);
		// 42 minutes against the 814.8 seconds #606's own 35-document vault took, which is the
		// margin the 3x multiplier is for: that run was 20 documents wide on a loaded box.
		expect(timeoutMs).toBe(42 * 60_000);
	});

	it('always derives from the estimate, so no caller can substitute a flat number', () => {
		expect(timeoutMsForEstimate({ estimatedMinutes: 10 })).toBe(
			10 * 60_000 * IMPORT_TIMEOUT_HEADROOM_MULTIPLIER
		);
		expect(timeoutMsForEstimate({ estimatedMinutes: 10 }, 1)).toBe(10 * 60_000);
	});
});
