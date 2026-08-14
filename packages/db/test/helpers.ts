import { randomUUID } from 'node:crypto';
import { createDb, type Db } from '../src/index.js';
import { user } from '../src/schema/auth.js';
import { universe } from '../src/schema/universe.js';
import { TEST_DATABASE_URL } from './env.js';

export function testDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 5 });
}

/** A short, collision-free suffix so parallel test files never trip each other's unique
 * constraints (owner ids, slugs) even though they share one database for the run. */
export function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** `universe.owner_user_id` and `universe_member.user_id` point at Better Auth's user
 * table, so a test that wants a universe needs a real account behind it. Cheaper to make
 * that automatic here than to remember it in thirty places. */
export async function insertUser(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
	const id = overrides.id ?? unique('user');
	const [row] = await db
		.insert(user)
		.values({
			id,
			name: 'Test Owner',
			email: `${id}@canonry.invalid`,
			emailVerified: true,
			...overrides
		})
		.returning();
	if (!row) throw new Error('insert did not return a row');
	return row;
}

export async function insertHomebrewUniverse(
	db: Db,
	overrides: Partial<typeof universe.$inferInsert> = {}
) {
	// An explicit owner in the overrides is trusted to exist already, which is what a test
	// about two universes sharing an owner needs.
	const ownerUserId = overrides.ownerUserId ?? (await insertUser(db)).id;
	const [row] = await db
		.insert(universe)
		.values({
			ownerUserId,
			name: 'Test Universe',
			slug: unique('universe'),
			kind: 'homebrew',
			...overrides
		})
		.returning();
	if (!row) throw new Error('insert did not return a row');
	return row;
}

/** Postgres constraint violations surface through drizzle as a DrizzleQueryError whose
 * own .message is just "Failed query: ...params"; the real Postgres error, with the
 * violated constraint's name, is on .cause. Asserting on that is what actually proves
 * *which* constraint fired rather than merely that the insert failed somehow. */
export async function expectConstraintViolation(
	promise: Promise<unknown>,
	constraintName: string
): Promise<void> {
	let caught: unknown;
	try {
		await promise;
	} catch (err) {
		caught = err;
	}
	if (caught === undefined) {
		throw new Error(`expected constraint "${constraintName}" violation, but the insert succeeded`);
	}
	if (caught && typeof caught === 'object' && 'cause' in caught) {
		const cause = caught.cause;
		if (
			cause &&
			typeof cause === 'object' &&
			'constraint_name' in cause &&
			cause.constraint_name === constraintName
		) {
			return;
		}
	}
	throw new Error(`expected constraint "${constraintName}" violation, got: ${String(caught)}`);
}
