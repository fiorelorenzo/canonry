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
 * module load, which drives a real gateway and a real database. So the budget guard below
 * pins the seam the way `AGENTS.md`'s own convention for `playbooks.generated.ts` does for a
 * different kind of drift - a structural check on the source that fails loudly if a hardcoded
 * number is reintroduced, rather than a behavioural test that would need the live gateway
 * this package's other e2e scripts require and this repo's test suite does not run.
 *
 * The matching-threshold guard further down used to work the same way and no longer does.
 * Reading source text is the weakest form of "the harness scores with the product's own
 * band", and issue #279 showed how weak: the product started returning each band paired with
 * the scorer it was measured for, this file stopped importing one constant by name, and the
 * guard went red over a change that made the harness more correct. `./matching.ts` exists so
 * that half can be asked behaviourally instead. The budget half has no equivalent yet, which
 * is why the two describes below do not look alike.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@canonry/db';
import type { ResolvedModel } from '@canonry/ai';
import { bandedSimilarity, EMBEDDING_MATCH_THRESHOLDS, MATCH_THRESHOLDS } from '@canonry/import';
import { benchMatching } from './matching.js';

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

describe("packages/bench uses the product's own matching thresholds (issue #279)", () => {
	// What this defends has not changed since the guard was written: a matching audit found
	// this harness "defines its own thresholds" separately from the product's, and it did - a
	// hand-copied `{ matchAbove: 0.85, newBelow: 0.5 }` beside a comment promising it matched
	// `onboarding.ts`, with nothing enforcing the promise.
	//
	// How it defends it has changed. The first version read this file's source for an
	// `import { MATCH_THRESHOLDS } from '@canonry/import'` statement, and that is the weak
	// form twice over: it passes on any file that spells the import that way whatever it then
	// does with it, and it failed the moment the product stopped exposing one band under that
	// name and started returning the band paired with the scorer it was measured for - a point
	// at which the harness was more correct than before, not less. Asking what
	// `benchMatching` actually resolves is the strong form, and it is indifferent to how any
	// import statement is written.
	//
	// Identity rather than deep equality on purpose: `toEqual` would accept a re-inlined
	// `{ matchAbove: 0.96, newBelow: 0.7 }`, which is the exact regression being watched for,
	// right up until somebody changes the constant and the copy silently keeps the old numbers.
	const NEVER_CALLED_DB = {} as Db;
	const EMBEDDING_MODEL: ResolvedModel = {
		purpose: 'embedding',
		provider: 'alibaba',
		modelId: 'qwen3-embedding-4b',
		params: {}
	};

	let priorKey: string | undefined;
	beforeAll(() => {
		// `benchMatching` reads the gateway credential eagerly, so this harness fails at wiring
		// time rather than mid-run. A placeholder satisfies that: nothing here calls the
		// embedder, and building a gateway-routed model object contacts nothing.
		priorKey = process.env.AI_GATEWAY_API_KEY;
		process.env.AI_GATEWAY_API_KEY ??= 'test-key-not-a-real-credential';
	});
	afterAll(() => {
		if (priorKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
		else process.env.AI_GATEWAY_API_KEY = priorKey;
	});

	it('resolves the embedding scorer against the very band @canonry/import measured for it', () => {
		const matching = benchMatching({
			db: NEVER_CALLED_DB,
			model: EMBEDDING_MODEL,
			userId: 'bench-user',
			universeId: 'bench-universe'
		});

		expect(matching.isLexical).toBe(false);
		expect(matching.thresholds).toBe(EMBEDDING_MATCH_THRESHOLDS);
	});

	it('covers the lexical band too, because two bands are two chances to hand-copy one', () => {
		// The band a credentials-less box resolves. `packages/bench` never runs this branch - it
		// refuses to measure anything through a stand-in - but the pairing it would use is the
		// same function's other answer, and leaving it unchecked is how the first version of
		// this guard came to know about only one of the two constants.
		const lexical = bandedSimilarity(null);

		expect(lexical.isLexical).toBe(true);
		expect(lexical.thresholds).toBe(MATCH_THRESHOLDS);
		expect(lexical.thresholds).not.toBe(EMBEDDING_MATCH_THRESHOLDS);
	});

	it('never re-inlines a threshold literal into the self-executing runner', () => {
		// The one thing that still has to be checked by reading source text: `import.ts` runs
		// `await main()` at module load against a real gateway and a real database, so no test
		// can import it to see what it passes. This catches a literal reappearing there, and
		// the assertion below catches it going anywhere other than the resolved band.
		expect(SOURCE).not.toMatch(/matchAbove:\s*[\d.]/);
		expect(SOURCE).not.toMatch(/newBelow:\s*[\d.]/);
		expect(SOURCE).toMatch(/thresholds: matching\.thresholds/);
		expect(SOURCE).toMatch(/similarity: matching\.similarity/);
	});
});
