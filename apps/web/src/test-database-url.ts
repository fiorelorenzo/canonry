/**
 * The one place this app decides which database its tests use.
 *
 * It exists because there are two consumers that must not disagree and a comment could not
 * stop them: `vite.config.ts` seeds `process.env.DATABASE_URL` for the test workers, and
 * `src/test-global-setup.ts` drops, creates and migrates a database in a separate process
 * (vitest global setup does not share memory with the workers, so it cannot be told). Those
 * two used to hold a copy of this expression each, with a comment on the second one promising
 * they were identical. They were not, twice, and the second time is issue #759: the config's
 * `??=` discarded the whole right-hand side whenever `DATABASE_URL` was already in the
 * environment, so the suite migrated one database and queried another. A comment cannot fail
 * CI; one function that both of them call cannot drift.
 *
 * **The order, and why it is this way round.** The two `TEST_*` variables are an explicit
 * request from whoever started the run, typed on the command line or set by CI.
 * `DATABASE_URL` is ambient: on the dev box every process the Paseo daemon starts inherits
 * one naming the shared dev database, which no agent chose and none can see with
 * `env | grep DATABASE_URL` in its own tool shell. An ambient value must never outrank an
 * explicit one, because the explicit one is the whole isolation mechanism: `TEST_DB_SUFFIX`
 * is how nine concurrent worktrees avoid writing into each other's databases, and it stops
 * working the moment something inherited can silently beat it. That is not hypothetical
 * either. `AGENTS.md` records a wave where nine agents all wrote to the dev database
 * believing they were isolated, and a later run where an exported `DATABASE_URL` pointed
 * `TEST_DB_SUFFIX=w725 pnpm --filter web test` at a demo database with 288 fixture proposals
 * in it, which failed three tests on counts and passed when run alone.
 *
 * So: an explicit URL, then an explicit suffix, then whatever the environment happens to
 * carry, then the dev database. This matches `packages/db/test/env.ts`, which the other six
 * Postgres-touching packages share and which never consults `DATABASE_URL` at all.
 *
 * The `DATABASE_URL` rung is deliberate rather than a leftover: with no suffix and no
 * `TEST_DATABASE_URL`, `pnpm --filter web test` runs against the dev database, migrated in
 * place instead of dropped, which is what makes a bare run useful on a fresh checkout.
 *
 * Empty strings count as absent. `export TEST_DB_SUFFIX=` is how a shell carries a variable
 * somebody meant to clear, and resolving that to `canonry_test_` would be a real database
 * with a name nobody intended.
 */
const HOST = 'postgres://canonry:canonry@127.0.0.1:55432';

/** The shared dev database, and the last resort. Migrated in place, never dropped. */
export const DEV_DATABASE_URL = `${HOST}/canonry`;

export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
	if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
	if (env.TEST_DB_SUFFIX) return `${HOST}/canonry_test_${env.TEST_DB_SUFFIX}`;
	return env.DATABASE_URL || DEV_DATABASE_URL;
}
