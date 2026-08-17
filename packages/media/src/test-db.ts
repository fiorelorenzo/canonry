/** Shared real-Postgres connection helper for this package's integration tests. */
import { createDb, sql, type Db } from '@canonry/db';

// The database name carries a per-run suffix so two test runs in the same checkout never
// share one database - see packages/ai/src/test-db.ts, which this mirrors exactly.
const suffix = process.env.TEST_DB_SUFFIX ?? 'local';

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_media_${suffix}`;

export function openTestDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 1 });
}

/**
 * `image_model_config` is a global singleton (one active row per feature, enforced by
 * `image_model_active_feature_key`): models.test.ts and generate.test.ts both drive its
 * `portrait`/`variants` rows to different values and expect exclusive control of the table
 * for as long as their own assertions depend on it. Vitest runs this package's files in
 * parallel against the one database `openTestDb` points at (#193), so without a lock one
 * file's `beforeEach` silently overwrites the row the other file's `expect` is about to read
 * - a real, easily-reproduced race, not a hypothetical one (see #193's PR for a standalone
 * repro). A session-scoped Postgres advisory lock, acquired once in a file's `beforeAll` and
 * released once in its `afterAll`, turns the two files' runs into a deterministic queue
 * instead: whichever acquires it first finishes its whole suite before the other's first
 * query runs. `db` here is the single (`max: 1`) connection each file opens once in
 * `beforeAll`, so the lock naturally spans everything that file does with the table.  Any
 * future file that drives `image_model_config` must take this same lock in its own
 * `beforeAll`/`afterAll` or it is exposed to the identical race.
 */
export async function lockImageModelConfigForFile(db: Db): Promise<void> {
	await db.execute(sql`select pg_advisory_lock(hashtext('image_model_config'), 0)`);
}

export async function unlockImageModelConfigForFile(db: Db): Promise<void> {
	await db.execute(sql`select pg_advisory_unlock(hashtext('image_model_config'), 0)`);
}
