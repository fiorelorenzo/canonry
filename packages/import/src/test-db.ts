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
