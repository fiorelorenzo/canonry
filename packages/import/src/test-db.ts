/** Shared real-Postgres connection helper for this package's integration tests - mirrors
 * packages/media's src/test-db.ts (and packages/ai's) exactly, including the per-run
 * database name suffix so two test runs in the same checkout never share one database. */
import { createDb, type Db } from '@canonry/db';

const suffix = process.env.TEST_DB_SUFFIX ?? 'local';

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_import_${suffix}`;

export function openTestDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 1 });
}

/**
 * The `concurrencyLimit` every test in this package that admits an import job passes, and
 * the answer to issue #658.
 *
 * `admitImportJob` counts **every** `import_job` row in the database whose status is
 * `running`, with no scoping by user or universe, because the cap it enforces is about the
 * machine's capacity and not about one account (`packages/db/src/queries/import.ts`, issue
 * #30). Vitest's fork pool runs this package's files concurrently against the one database
 * `openTestDb` names, since AGENTS.md's suffix convention is per run and not per file, so
 * that count is shared state between files. Five files here admit jobs, and one of them,
 * `estimate-history.test.ts`, deliberately holds a job in `running` forever, because its
 * subject is that a still-running job is not evidence about what a document costs (#610).
 * A file passing a limit of 5, or of 20 as `estimate-history.test.ts` did, is therefore
 * asking to be admitted against a budget four other files are spending, and none of them is
 * testing admission.
 *
 * That is what failed once during #637's verification: `job-runner-declined.test.ts`
 * asserting `admission.admitted` in a PR that touched no file in this package. Measured on
 * 2026-08-24, an idle box reaches 4 concurrent `running` rows during this suite, one short
 * of the 5 those files were passing. Holding four more rows in `running` while the suite
 * runs, which is what a slightly different interleaving of these same files produces, turns
 * the flake into 14 deterministic failures across three of them.
 *
 * A limit no interleaving of this suite can reach removes the coupling instead of ordering
 * it. This is deliberately **not** the advisory-lock shape of `lockImageModelConfigForFile`
 * (`packages/media/src/test-db.ts`, `packages/db/test/helpers.ts`): a lock is what you need
 * when two files want exclusive control of a shared row whose value is under test, and it
 * would serialise this package's five slowest files to protect a number that no test here
 * asserts. `job-runner-relation-sizing.test.ts` had already worked this out for itself and
 * fixed its own call site during #647; this is that fix promoted to one place so the next
 * file cannot miss it.
 *
 * The one case that would need the lock instead is a test asserting a **refusal** - it has
 * to control the running count, not opt out of it. There is none in this package today, and
 * `packages/db/test/import.test.ts` is where that assertion actually lives.
 *
 * ### Every table more than one file here writes
 *
 * The other half of #658, which is the part worth having before the next flake: every
 * table more than one of this package's test files writes, and why only one of them is
 * contended. Six files share the database `openTestDb` names (`estimate-history`,
 * `job-runner-declined`, `job-runner-guards`, `job-runner-relation-sizing`,
 * `job-runner-relations`, `media-store`); `job-runner.test.ts` has its own and is outside
 * all of this.
 *
 *  - `user`, `universe`, `entity`, and everything reached through them (`proposal`,
 *    `proposal_plan`, `revision`, `relation`, `entity_source_ref`, `media_asset`,
 *    `credit_transaction`, `model_call`, `user_billing`): a fresh row per test under a unique
 *    id or slug, so two files never address the same row. This is what the package has always
 *    relied on and it holds.
 *  - `operation_price`: five files insert `import.document` with `onConflictDoNothing`, and
 *    every one of those inserts is inert, because migration 0004 already seeds that row at
 *    0.1916 credits. Identical values would make it harmless anyway; nothing lands at all.
 *    A future file wanting a *different* price for an operation is where #193's shape would
 *    arrive here, and that is the case for an advisory lock rather than for a bigger number.
 *  - `relation_type`: the shipped catalogue is the one row set here that is global, since
 *    `universe_id IS NULL` means shipped (`packages/db/src/schema/relation.ts`). No test
 *    writes it: a full run leaves the same 10 shipped rows the migrations created, and the
 *    rows the sizing tests create carry a universe. #658 guessed this table and the guess
 *    was wrong, which is worth recording so the next reader does not re-check it.
 *  - `import_job`: the real one, and not a row two files write. It is a *count* they all
 *    read, through `admitImportJob`, which is what the rest of this comment is about.
 *
 * So the answer to "why did this package never have a lock helper when two siblings do" is
 * that nothing here shares a row whose value is under test, and still does not. What it
 * shares is a global counter, and a counter is opted out of rather than queued for.
 */
export const TEST_CONCURRENCY_LIMIT = 100_000;
