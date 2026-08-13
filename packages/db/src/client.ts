import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export function createDb(connectionString: string, opts?: { max?: number }): Db {
	const client = postgres(connectionString, { max: opts?.max ?? 10 });
	return drizzle(client, { schema });
}

/** `select 1`, false on failure, never throws. */
export async function ping(db: Db): Promise<boolean> {
	try {
		await db.execute(sql`select 1`);
		return true;
	} catch {
		return false;
	}
}

export async function closeDb(db: Db): Promise<void> {
	await db.$client.end();
}
