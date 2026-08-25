import { describe, expect, it } from 'vitest';
import { DEV_DATABASE_URL, testDatabaseUrl } from './test-database-url';

/**
 * Issue #759: the precedence between `TEST_DATABASE_URL`, `TEST_DB_SUFFIX` and `DATABASE_URL`,
 * asserted rather than described.
 *
 * This is the assertion that would have caught the bug, and it needs no database: the whole
 * defect was that `vite.config.ts` and `src/test-global-setup.ts` each held a copy of this
 * expression and the copies disagreed for three of the eight combinations, so the suite
 * prepared one database and queried another while passing. Both of them call `testDatabaseUrl`
 * now, so what is left to protect is the order itself, and the order is a real contract: it is
 * what makes `TEST_DB_SUFFIX` a usable isolation mechanism on a box where `DATABASE_URL` is
 * inherited by everything the Paseo daemon starts.
 */
const HOST = 'postgres://canonry:canonry@127.0.0.1:55432';
const AMBIENT = `${HOST}/canonry_ambient`;
const EXPLICIT = `${HOST}/canonry_test_ci`;

describe('testDatabaseUrl', () => {
	it.each([
		['nothing set', {}, DEV_DATABASE_URL],
		['TEST_DB_SUFFIX alone', { TEST_DB_SUFFIX: 'w759' }, `${HOST}/canonry_test_w759`],
		['DATABASE_URL alone', { DATABASE_URL: AMBIENT }, AMBIENT],
		['TEST_DATABASE_URL alone', { TEST_DATABASE_URL: EXPLICIT }, EXPLICIT],
		[
			'TEST_DB_SUFFIX beats an inherited DATABASE_URL',
			{ DATABASE_URL: AMBIENT, TEST_DB_SUFFIX: 'w759' },
			`${HOST}/canonry_test_w759`
		],
		[
			'TEST_DATABASE_URL beats an inherited DATABASE_URL',
			{ DATABASE_URL: AMBIENT, TEST_DATABASE_URL: EXPLICIT },
			EXPLICIT
		],
		[
			'TEST_DATABASE_URL beats TEST_DB_SUFFIX',
			{ TEST_DATABASE_URL: EXPLICIT, TEST_DB_SUFFIX: 'w759' },
			EXPLICIT
		],
		[
			'all three: TEST_DATABASE_URL wins',
			{ DATABASE_URL: AMBIENT, TEST_DATABASE_URL: EXPLICIT, TEST_DB_SUFFIX: 'w759' },
			EXPLICIT
		]
	])('%s', (_label, env, expected) => {
		expect(testDatabaseUrl(env)).toBe(expected);
	});

	// `export TEST_DB_SUFFIX=` is what a shell carries for a variable somebody meant to clear,
	// and it used to resolve through `??` as though it were set. `canonry_test_` is a database
	// name nobody asked for, and an empty `TEST_DATABASE_URL` is a connection string to nowhere.
	it('treats an empty string as absent, not as a request', () => {
		expect(testDatabaseUrl({ TEST_DB_SUFFIX: '', DATABASE_URL: AMBIENT })).toBe(AMBIENT);
		expect(testDatabaseUrl({ TEST_DATABASE_URL: '', TEST_DB_SUFFIX: 'w759' })).toBe(
			`${HOST}/canonry_test_w759`
		);
		expect(testDatabaseUrl({ DATABASE_URL: '' })).toBe(DEV_DATABASE_URL);
	});
});
