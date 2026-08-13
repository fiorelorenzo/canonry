import postgres from 'postgres';
import { closeDb, createDb, runMigrations } from '../src/index.js';
import { TEST_DATABASE_URL } from './env.js';

// Runs once before the whole test run. Drops and recreates a dedicated test database, then
// applies packages/db/migrations from scratch through the same runMigrations the production
// deploy uses, so the migrations themselves are what's under test, not just the TS schema.
// This makes `pnpm test` idempotent: every run starts from a clean, freshly migrated database
// regardless of what a previous run left behind.
export default async function setup(): Promise<void> {
	const targetUrl = new URL(TEST_DATABASE_URL);
	const dbName = targetUrl.pathname.replace(/^\//, '');
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
