/**
 * Creates and migrates this package's own test database before the run, exactly as
 * packages/ai/src/test-global-setup.ts does and for the same reason: a package's tests
 * owning their own database is the difference between a suite you can run and a suite you
 * can run only in the order somebody else happened to use.
 */
import { closeDb, createDb, runMigrations } from '@canonry/db';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './test-db.js';

export default async function setup(): Promise<void> {
	const target = new URL(TEST_DATABASE_URL);
	const dbName = target.pathname.replace(/^\//, '');
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
