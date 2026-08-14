/**
 * Creates and migrates this package's own test database before the run, exactly as
 * @canonry/ai's test-global-setup.ts does - a package's tests own their own database
 * rather than depending on another package's run having created it first.
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

	const db = createDb(TEST_DATABASE_URL, { max: 1 });
	try {
		await runMigrations(db);
	} finally {
		await closeDb(db);
	}
}
