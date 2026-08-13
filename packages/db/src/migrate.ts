import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, createDb, type Db } from './client.js';

const migrationsFolder = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'migrations'
);

/** Applies packages/db/migrations against `db`. Safe to call repeatedly: drizzle tracks
 * applied migrations in its own `drizzle.__drizzle_migrations` table. */
export async function runMigrations(db: Db): Promise<void> {
	await migrate(db, { migrationsFolder });
}

async function main(): Promise<void> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error('DATABASE_URL is not set');
	}
	const db = createDb(connectionString, { max: 1 });
	try {
		await runMigrations(db);
	} finally {
		await closeDb(db);
	}
}

// CLI entry point: `tsx src/migrate.ts`, driven by DATABASE_URL. Guarded so importing this
// module as a library (via src/index.ts) never triggers a migration run as a side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exitCode = 1;
	});
}
