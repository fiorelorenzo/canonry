/** Shared real-Postgres connection helper for this package's integration tests. */
import { createDb, type Db } from '@canonry/db';

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ?? 'postgres://canonry:canonry@127.0.0.1:55432/canonry_test';

export function openTestDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 1 });
}
