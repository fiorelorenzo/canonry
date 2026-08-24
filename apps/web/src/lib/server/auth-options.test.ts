/**
 * Issue #685: the one assumption `packages/db/test/auth-schema.test.ts` rests on.
 *
 * That file is the guard for `packages/db/src/schema/auth.ts`, which is hand-carried
 * against Better Auth's own table definitions: it asks `getAuthTables` what the installed
 * version declares and compares that against the real drizzle tables, so that the next
 * required field added in a minor version is a named test failure rather than the auth
 * outage #674 was.
 *
 * `getAuthTables` is a function of the options it is given, and `packages/db` cannot reach
 * this app's instance without depending on the app, so it calls it with empty options.
 * That is exact only while this deployment sets none of the option keys the function
 * actually branches on, and this file is where that is true, so this file asserts it.
 *
 * The list below is not a guess about which options might matter: it is every read of
 * `options` in `buildAuthTables` (`@better-auth/core/dist/db/get-tables.mjs`) that changes
 * the tables or the fields it returns. `options.user` is set here, for `deleteUser`, which
 * is why the assertions name the three sub-keys that move the schema rather than the
 * option objects themselves.
 *
 * If one of these ever has to be set, the guard in packages/db stops covering whatever it
 * adds, and it has to be taught the new shape in the same commit.
 */
import { auth } from '$lib/server/auth';
import { describe, expect, it } from 'vitest';

describe('the auth options packages/db/test/auth-schema.test.ts assumes (issue #685)', () => {
	it('renames no table, renames no column and declares no additional field', () => {
		const options = auth().options;
		for (const [model, table] of Object.entries({
			user: options.user,
			session: options.session,
			account: options.account,
			verification: options.verification
		})) {
			expect(table?.modelName, `${model}.modelName would rename the table`).toBeUndefined();
			expect(table?.fields, `${model}.fields would rename its columns`).toBeUndefined();
			expect(
				table?.additionalFields,
				`${model}.additionalFields would add fields the packages/db guard cannot see`
			).toBeUndefined();
		}
	});

	it('loads no plugin', () => {
		// A plugin's own `schema` merges fields into these four tables and can add tables of its
		// own, which is the largest way this app could move `getAuthTables` out from under the
		// guard.
		expect(auth().options.plugins ?? [], 'a plugin can add both fields and tables').toEqual([]);
	});

	it('keeps every table in the database and adds none', () => {
		const options = auth().options;
		// `secondaryStorage` is the switch that takes `session` and `verification` out of
		// `getAuthTables` entirely, so with it set the guard would be asserting against two
		// tables while the app ran on four.
		expect(
			options.secondaryStorage,
			'secondaryStorage drops tables from the schema'
		).toBeUndefined();
		// The only option that adds a table without a plugin. Nothing in packages/db carries a
		// `rateLimit` table, so this would be a missing table rather than a missing column.
		expect(options.rateLimit?.storage, 'database rate limiting adds a rateLimit table').not.toBe(
			'database'
		);
	});
});
