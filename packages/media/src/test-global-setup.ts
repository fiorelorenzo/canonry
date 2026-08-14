/**
 * Creates and migrates this package's own test database before the run, exactly like
 * packages/ai's test-global-setup.ts (copied close to verbatim, see that file's doc for
 * why each package owns its own database rather than relying on run order).
 */
import { closeDb, createDb, runMigrations } from '@canonry/db';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './test-db.js';

// Refuses to touch the shared development database, whatever the environment says. This
// harness drops and recreates the database TEST_DATABASE_URL names, and a run pointed at
// `canonry` by mistake destroys the fixture world and every account somebody signed up while
// working. That has already happened once. A test database is cheap; the guard costs one
// comparison.
const PROTECTED_DATABASES = new Set(['canonry', 'postgres', 'template1']);

function assertDisposable(dbName: string): void {
	if (PROTECTED_DATABASES.has(dbName)) {
		throw new Error(
			`refusing to drop database "${dbName}": this harness recreates whatever ` +
				`TEST_DATABASE_URL names, and that name is the shared development database. ` +
				`Point TEST_DATABASE_URL at a disposable database instead, for example ` +
				`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_local.`
		);
	}
}

export default async function setup(): Promise<void> {
	const target = new URL(TEST_DATABASE_URL);
	const dbName = target.pathname.replace(/^\//, '');
	assertDisposable(dbName);
	if (!dbName) throw new Error(`TEST_DATABASE_URL has no database name: ${TEST_DATABASE_URL}`);

	const adminUrl = new URL(TEST_DATABASE_URL);
	adminUrl.pathname = '/postgres';
	const admin = postgres(adminUrl.toString(), { max: 1 });
	try {
		await admin.unsafe(
			'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
			[dbName]
		);
		await admin.unsafe(`drop database if exists "${dbName}"`);
		await admin.unsafe(`create database "${dbName}"`);
	} finally {
		await admin.end();
	}

	// The migrations, not the TypeScript schema, are what production applies, so they are
	// what the tests run against.
	const db = createDb(TEST_DATABASE_URL, { max: 1 });
	try {
		await runMigrations(db);
	} finally {
		await closeDb(db);
	}
}
