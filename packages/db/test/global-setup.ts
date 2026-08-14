import postgres from 'postgres';
import { closeDb, createDb, runMigrations } from '../src/index.js';
import { TEST_DATABASE_URL } from './env.js';

// Runs once before the whole test run. Drops and recreates a dedicated test database, then
// applies packages/db/migrations from scratch through the same runMigrations the production
// deploy uses, so the migrations themselves are what's under test, not just the TS schema.
// This makes `pnpm test` idempotent: every run starts from a clean, freshly migrated database
// regardless of what a previous run left behind.
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
	const targetUrl = new URL(TEST_DATABASE_URL);
	const dbName = targetUrl.pathname.replace(/^\//, '');
	assertDisposable(dbName);
	if (!dbName) {
		throw new Error(`TEST_DATABASE_URL has no database name: ${TEST_DATABASE_URL}`);
	}

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

	const db = createDb(TEST_DATABASE_URL, { max: 1 });
	try {
		await runMigrations(db);
	} finally {
		await closeDb(db);
	}
}
