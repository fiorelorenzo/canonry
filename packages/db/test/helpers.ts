import { randomUUID } from 'node:crypto';
import { createDb, sql, type Db } from '../src/index.js';
import { user } from '../src/schema/auth.js';
import { universe } from '../src/schema/universe.js';
import { TEST_DATABASE_URL } from './env.js';

export function testDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 5 });
}

/**
 * `image_model_config` is a global singleton (one active row per feature). Two files in
 * this package's own test/ drive its `portrait`/`variants` rows -
 * pricing-corrections.test.ts asserts the exact params the migrations leave there, and any
 * future file that rewrites those rows as a fixture (media.test.ts did, before it moved to
 * the `scene` feature specifically to avoid this) races it - Vitest runs this package's
 * files in parallel against the one database `testDb` points at (#341, #193 one package
 * over; see packages/media/src/test-db.ts's `lockImageModelConfigForFile`, which this
 * mirrors). A session-scoped Postgres advisory lock, acquired once in a file's `beforeAll`
 * and released once in its `afterAll`, turns concurrent files' runs into a deterministic
 * queue instead: whichever acquires it first finishes its whole use of the table before the
 * other's first query runs.
 *
 * The lock is tied to the Postgres session (connection) that takes it, so every query made
 * while holding it has to run on that same connection - `testDb`'s five-connection pool
 * cannot guarantee that. Use `lockableTestDb`, not `testDb`, for a `db` passed here.
 *
 * Any future test file that reads or writes `image_model_config` must take this same lock
 * in its own `beforeAll`/`afterAll` (scoped to just the describe block that touches the
 * table, if the rest of the file does not) or it is exposed to the identical race.
 */
export function lockableTestDb(): Db {
	return createDb(TEST_DATABASE_URL, { max: 1 });
}

export async function lockImageModelConfigForFile(db: Db): Promise<void> {
	await db.execute(sql`select pg_advisory_lock(hashtext('image_model_config'), 0)`);
}

export async function unlockImageModelConfigForFile(db: Db): Promise<void> {
	await db.execute(sql`select pg_advisory_unlock(hashtext('image_model_config'), 0)`);
}

/**
 * The `concurrencyLimit` a test in this package passes to `admitImportJob` when what it
 * needs is a running job rather than a verdict on the cap, and the answer to issue #682.
 *
 * `admitImportJob` counts every `import_job` row in the database whose status is `running`,
 * with no scoping by user or universe, because the cap it enforces is about the machine's
 * capacity and not about one account (`src/queries/import.ts`, issue #30). Vitest's fork
 * pool runs this package's files concurrently against the one database `env.ts` names, since
 * AGENTS.md's suffix convention is per run and not per file, so that count is shared state
 * between files. A test passing a bare 5 is asking to be admitted against a budget its
 * siblings are spending. Polling the running count every 25ms through a full run of this
 * package on 2026-08-24 reached 4 concurrent rows over 1341 samples and never 5, so the
 * margin was one row.
 *
 * This is #658 and #683 one package over, and it is deliberately the same fix rather than
 * the advisory-lock shape above: a lock is what you need when two files want exclusive
 * control of a shared row whose value is under test, and no assertion here reads the running
 * count, so a lock would order the coupling rather than remove it. The full argument is in
 * `packages/import/src/test-db.ts`.
 *
 * The exception is `import.test.ts`'s refusal test, which is the assertion #683 predicted
 * would live here and the one case that has to control the count instead of opting out of
 * it. It reads `countRunningImportJobs` and passes that as the limit, which is correct as
 * written, so it does not use this constant and should not be tidied into its shape.
 */
export const TEST_CONCURRENCY_LIMIT = 100_000;

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
