/** Shared real-Postgres connection helper for this package's integration tests. */
import { createDb, type Db } from '@canonry/db';

// The database name carries a per-run suffix so two test runs in the same checkout never
// share one database - see packages/ai/src/test-db.ts, which this mirrors exactly.
const suffix = process.env.TEST_DB_SUFFIX ?? 'local';

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_media_${suffix}`;

export function openTestDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 1 });
}
