/**
 * Issue #451, decision U2: migration 0050 moves any real text a GM had already written
 * in `universe.loremaster_description` into a custom `narration_style` row, and points
 * `universe.narration_style_id` at it, before dropping the column. The package's own
 * shared test database has already had every migration through 0050 applied by the time
 * any test file runs (test/global-setup.ts), so `loremaster_description` no longer
 * exists there to write to - proving the migration carries old data forward needs a
 * database that has not run migration 0050 yet.
 *
 * This file builds one by hand: every migration up to (but not including) 0050, applied
 * directly against a scratch database via drizzle's own `readMigrationFiles` (the same
 * function `runMigrations` uses internally) rather than `runMigrations` itself, which
 * always runs every pending migration through the latest and so cannot stop short of it.
 * A raw insert then stands in for a GM's pre-migration description, migration 0050's own
 * SQL runs on top of it, and the assertions read the result through the normal typed
 * schema - by that point the scratch database's shape matches it exactly.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, eq, type Db } from '../src/index.js';
import { narrationStyle } from '../src/schema/narration.js';
import { universe } from '../src/schema/universe.js';
import { TEST_DATABASE_URL } from './env.js';

const migrationsFolder = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'migrations'
);

// The tag `drizzle-kit generate` gave migration 0050 (its file is
// `<TARGET_TAG>.sql`) - looked up by name in the journal, not assumed to be the last
// entry, so this test keeps working once a later wave adds its own migration on top.
const TARGET_TAG = '0050_skinny_apocalypse';

interface JournalEntry {
	tag: string;
}

function journalIndexOf(tag: string): number {
	const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
	const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
	const index = journal.entries.findIndex((entry) => entry.tag === tag);
	if (index < 0) throw new Error(`migration tag "${tag}" not found in ${journalPath}`);
	return index;
}

async function applyMigration(client: postgres.Sql, statements: string[]): Promise<void> {
	for (const statement of statements) {
		const trimmed = statement.trim();
		if (trimmed.length === 0) continue;
		await client.unsafe(statement);
	}
}

describe('migration 0050: an existing loremaster_description survives (issue #451, decision U2)', () => {
	const scratchName = `canonry_migration_0050_${randomUUID().slice(0, 8)}`;
	let admin: postgres.Sql;
	let scratch: postgres.Sql;
	let scratchUrl: string;

	beforeAll(async () => {
		const adminUrl = new URL(TEST_DATABASE_URL);
		adminUrl.pathname = '/postgres';
		admin = postgres(adminUrl.toString(), { max: 1 });
		await admin.unsafe(`create database "${scratchName}"`);

		const url = new URL(TEST_DATABASE_URL);
		url.pathname = `/${scratchName}`;
		scratchUrl = url.toString();
		scratch = postgres(scratchUrl, { max: 1 });
	});

	afterAll(async () => {
		await scratch.end();
		await admin.unsafe(
			'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
			[scratchName]
		);
		await admin.unsafe(`drop database if exists "${scratchName}"`);
		await admin.end();
	});

	it("carries an existing GM's loremaster_description forward into a custom narration_style row and points the universe at it, leaving an empty description with no row and no pointer", async () => {
		const migrations = readMigrationFiles({ migrationsFolder });
		const targetIndex = journalIndexOf(TARGET_TAG);
		const before = migrations.slice(0, targetIndex);
		const target = migrations[targetIndex];
		if (!target)
			throw new Error(`migration at index ${targetIndex} missing from readMigrationFiles`);

		// Every migration up to, but not including, 0050 - the schema exactly as it stood
		// the moment before this migration existed, `loremaster_description` included.
		for (const migration of before) {
			await applyMigration(scratch, migration.sql);
		}

		// Two pre-existing universes, standing in for a real deployment's data: one with a
		// GM's own voice already written, one that never got one (the column's own empty
		// default). Both belong to a real user row - `owner_user_id` is a real fk.
		const ownerId = `migration-test-owner-${randomUUID().slice(0, 8)}`;
		await scratch.unsafe('insert into "user" ("id", "name", "email") values ($1, $2, $3)', [
			ownerId,
			'Migration Test Owner',
			`${ownerId}@canonry.invalid`
		]);
		const describedSlug = `migration-test-described-${randomUUID().slice(0, 8)}`;
		const silentSlug = `migration-test-silent-${randomUUID().slice(0, 8)}`;
		const voice = '  Wry, understated, never more than a sentence at a time.\n\t ';
		const describedRows = await scratch.unsafe<{ id: string }[]>(
			'insert into "universe" ("owner_user_id", "name", "slug", "kind", "loremaster_description") ' +
				"values ($1, 'Described World', $2, 'homebrew', $3) returning id",
			[ownerId, describedSlug, voice]
		);
		const describedId = describedRows[0]?.id;
		if (!describedId) throw new Error('pre-migration described universe insert returned no row');
		const silentRows = await scratch.unsafe<{ id: string }[]>(
			'insert into "universe" ("owner_user_id", "name", "slug", "kind") ' +
				"values ($1, 'Silent World', $2, 'homebrew') returning id",
			[ownerId, silentSlug]
		);
		const silentId = silentRows[0]?.id;
		if (!silentId) throw new Error('pre-migration silent universe insert returned no row');

		// Migration 0050 itself: the table, the pointer column, the carry-forward, the
		// column drop, and the preset seed, in the exact order the file on disk runs them.
		await applyMigration(scratch, target.sql);

		const db: Db = createDb(scratchUrl, { max: 1 });
		try {
			const [describedRow] = await db.select().from(universe).where(eq(universe.id, describedId));
			expect(describedRow?.narrationStyleId).toBeTruthy();
			// `loremaster_description` no longer exists on the row at all - the column was
			// dropped, not merely emptied.
			expect(describedRow).not.toHaveProperty('loremasterDescription');

			const [customRow] = await db
				.select()
				.from(narrationStyle)
				.where(eq(narrationStyle.id, describedRow!.narrationStyleId!));
			// Trimmed exactly the way `setLoremasterVoice` always trimmed it on the way in -
			// including the tab and newline whitespace a plain SQL `trim()` would have missed.
			expect(customRow?.promptClause).toBe(
				'Wry, understated, never more than a sentence at a time.'
			);
			expect(customRow?.universeId).toBe(describedId);
			expect(customRow?.slug).toBeNull();

			// A universe whose description was already empty gets no row and no pointer -
			// the same "no voice chosen" state a universe created after this migration means.
			const [silentRow] = await db.select().from(universe).where(eq(universe.id, silentId));
			expect(silentRow?.narrationStyleId).toBeNull();
			const silentCustomRows = await db
				.select()
				.from(narrationStyle)
				.where(eq(narrationStyle.universeId, silentId));
			expect(silentCustomRows).toHaveLength(0);

			// The shipped catalogue seeded by the same migration is there too, unaffected by
			// which universes happened to have a description already.
			const [warmCompanion] = await db
				.select()
				.from(narrationStyle)
				.where(eq(narrationStyle.slug, 'warm-companion'));
			expect(warmCompanion?.universeId).toBeNull();
		} finally {
			await closeDb(db);
		}
	});
});
