/**
 * Creates and migrates the database this app's server-side tests use, before they run.
 *
 * Without it the suite depends on some other package's test run having migrated the same
 * database first, which is true under `pnpm -r --sequential test` and false the moment
 * somebody runs `pnpm --filter web test` on its own or CI reorders the matrix. A suite that
 * passes only in one order is a suite that will fail for the next person for no reason they
 * can see.
 */
import { closeDb, createDb, runMigrations } from '@canonry/db';
import postgres from 'postgres';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

export default async function setup(): Promise<void> {
	const target = new URL(DATABASE_URL);
	const dbName = target.pathname.replace(/^\//, '');
	if (!dbName) throw new Error(`no database name in ${DATABASE_URL}`);

	// The dev database is shared with a running dev server and holds the fixture world, so
	// it is migrated in place rather than dropped. A dedicated test database is rebuilt from
	// scratch, which is what makes the run repeatable.
	const isDevDatabase = dbName === 'canonry';
	const adminUrl = new URL(DATABASE_URL);
	adminUrl.pathname = '/postgres';
	const admin = postgres(adminUrl.toString(), { max: 1 });
	try {
		if (!isDevDatabase) {
			await admin.unsafe(
				'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
				[dbName]
			);
			await admin.unsafe(`drop database if exists "${dbName}"`);
			await admin.unsafe(`create database "${dbName}"`);
		}
	} finally {
		await admin.end();
	}

	const db = createDb(DATABASE_URL, { max: 1 });
	try {
		await runMigrations(db);
	} finally {
		await closeDb(db);
	}
}
