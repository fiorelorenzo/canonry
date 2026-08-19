/**
 * Issue #272: `import.ts` used to admit and run every job under a hardcoded
 * `budgetCredits: 400` / `budget: { maxCredits: 400 }` - two hundred times what the
 * product's own onboarding routes would give a small job, which is why the harness's own
 * green reports (obsidian 35 documents, world-anvil 32, onenote 10) never proved the
 * product could complete an import through its own UI. The fix routes both numbers
 * through `deriveJobBudget` (`@canonry/import`'s `estimate.ts`), the same derivation
 * `apps/web/src/routes/onboarding/import/+page.server.ts` uses.
 *
 * `import.ts` itself cannot be imported directly in a test: it runs `await main()` at
 * module load, which drives a real gateway and a real database. This file pins the seam
 * the way `AGENTS.md`'s own convention for `playbooks.generated.ts` does for a different
 * kind of drift - a structural check on the source that fails loudly if a hardcoded
 * number is reintroduced, rather than a behavioural test that would need the live gateway
 * this package's other e2e scripts require and this repo's test suite does not run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./import.ts', import.meta.url)), 'utf8');

describe("packages/bench/src/e2e/import.ts admits jobs under the product's own budget (issue #272)", () => {
	it('imports deriveJobBudget/estimateAveragesForPlaybook from @canonry/import rather than deriving its own numbers', () => {
		expect(SOURCE).toMatch(
			/import\s*\{[^}]*\bderiveJobBudget\b[^}]*\}\s*from\s*'@canonry\/import'/s
		);
		expect(SOURCE).toMatch(
			/import\s*\{[^}]*\bestimateAveragesForPlaybook\b[^}]*\}\s*from\s*'@canonry\/import'/s
		);
	});

	it('never assigns a hardcoded numeric literal to budgetCredits or maxCredits again', () => {
		// The bug this pins: `budgetCredits: 400` and `budget: { maxCredits: 400 }`, two
		// independent hardcoded numbers that could (and did) drift from what the product
		// would actually admit. Both fields must now be fed the `budgetCredits` binding
		// `deriveJobBudget` returned - a bare digit after either key is exactly the
		// regression to catch.
		expect(SOURCE).not.toMatch(/budgetCredits:\s*\d/);
		expect(SOURCE).not.toMatch(/maxCredits:\s*\d/);
	});

	it("runOne feeds the same budgetCredits binding to both admission and the runner's own budget, so the two cannot diverge", () => {
		const match = SOURCE.match(
			/async function runOne\(input: RunOneInput\): Promise<RunReport> \{[\s\S]*?\n\}\n/
		);
		expect(
			match,
			'runOne function body not found - has it been renamed or restructured?'
		).not.toBeNull();
		const runOneBody = match![0];
		expect(runOneBody).toMatch(/const \{ estimate, budgetCredits \} = deriveJobBudget\(/);
		expect(runOneBody).toMatch(/\bbudgetCredits,\n/);
		expect(runOneBody).toMatch(/maxCredits: budgetCredits/);
	});
});
