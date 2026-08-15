/**
 * `resolveLocale`'s own negotiation order (issue #120, SPEC.md §17), exercised through
 * the real function `hooks.server.ts`'s `handle` calls, against a real Postgres row for
 * the account-preference tier - not a synthetic `negotiateLocale` unit test (that lives
 * in `@canonry/lang`, already 22 tests). What's under test here is the wiring: which
 * input this app actually reads for each tier, and in which order.
 *
 * Runs against `TEST_DATABASE_URL` (never the shared dev database - see this repo's own
 * `TEST_DB_SUFFIX` convention), one uniquely-suffixed user row per test. Importing
 * `hooks.server.ts` pulls in `$lib/server/auth.ts`, which needs `BETTER_AUTH_SECRET` to
 * even load (issue #86) - `vite.config.ts` sets a throwaway one for every test worker,
 * so this file needs nothing beyond `TEST_DATABASE_URL` to run under a plain `pnpm test`.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocale, type LocaleRequestEvent } from './hooks.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function eventFor(input: {
	pathname?: string;
	cookie?: string;
	acceptLanguage?: string;
	userId?: string | null;
}): LocaleRequestEvent {
	return {
		url: new URL(`https://canonry.test${input.pathname ?? '/'}`),
		cookies: { get: (name) => (name === 'canonry_locale' ? input.cookie : undefined) },
		request: {
			headers: new Headers(input.acceptLanguage ? { 'accept-language': input.acceptLanguage } : {})
		},
		locals: { user: input.userId ? { id: input.userId } : null }
	};
}

describe('resolveLocale: the negotiation order end to end (issue #120)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 1 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('falls back to English when nothing else is known', async () => {
		const locale = await resolveLocale(eventFor({}));
		expect(locale).toBe('en');
	});

	it('a fresh visitor with an Italian Accept-Language lands in Italian untouched', async () => {
		const locale = await resolveLocale(eventFor({ acceptLanguage: 'it-IT,it;q=0.9,en;q=0.5' }));
		expect(locale).toBe('it');
	});

	it('the canonry_locale cookie beats Accept-Language for a visitor with no account', async () => {
		const locale = await resolveLocale(
			eventFor({ cookie: 'en', acceptLanguage: 'it-IT,it;q=0.9' })
		);
		expect(locale).toBe('en');
	});

	it('a signed-in account preference beats both the cookie and Accept-Language', async () => {
		const id = unique('locale-negotiation');
		await db
			.insert(user)
			.values({ id, name: 'Negotiation Test', email: `${id}@test.canonry`, locale: 'it' });

		const locale = await resolveLocale(
			eventFor({ userId: id, cookie: 'en', acceptLanguage: 'en-US,en;q=0.9' })
		);
		expect(locale).toBe('it');
	});

	it('a signed-in account with no saved preference falls through to the cookie, then the header', async () => {
		const id = unique('locale-negotiation-null');
		await db.insert(user).values({ id, name: 'No Preference Yet', email: `${id}@test.canonry` });

		expect(await resolveLocale(eventFor({ userId: id, acceptLanguage: 'it-IT,it;q=0.9' }))).toBe(
			'it'
		);
		expect(
			await resolveLocale(eventFor({ userId: id, cookie: 'en', acceptLanguage: 'it-IT,it;q=0.9' }))
		).toBe('en');
	});

	it('an explicit account choice survives a sign-out and sign-in: no cookie, a different header, still holds', async () => {
		const id = unique('locale-survives-session');
		await db.insert(user).values({ id, name: 'Survives Sessions', email: `${id}@test.canonry` });

		// First visit: nothing chosen yet, negotiates from the header like any fresh
		// visitor - not yet an explicit choice.
		expect(await resolveLocale(eventFor({ userId: id, acceptLanguage: 'it-IT,it;q=0.9' }))).toBe(
			'it'
		);

		// The settings/language form action's own write path: a direct column update,
		// exactly what that route's `+page.server.ts` action does.
		await db.update(user).set({ locale: 'it' }).where(eq(user.id, id));

		// Sign out (no session, no cookie carried) and sign back in: a brand new request
		// with no cookie at all and an English browser header this time. The account
		// row, not the session or the cookie, is what makes the choice explicit and
		// permanent - negotiateLocale's own contract, exercised here against the real
		// row this app's action actually wrote.
		const afterSignInAgain = await resolveLocale(
			eventFor({ userId: id, acceptLanguage: 'en-US,en;q=0.9' })
		);
		expect(afterSignInAgain).toBe('it');
	});

	it('the players\u2019 wiki (routes/p/**) negotiates from Accept-Language alone, never an account or cookie', async () => {
		const id = unique('locale-public-wiki-gm');
		await db
			.insert(user)
			.values({ id, name: 'Previewing GM', email: `${id}@test.canonry`, locale: 'it' });

		// The signed-in GM's own account is Italian and a stray cookie says English -
		// neither may leak into a link they hand to their players.
		const locale = await resolveLocale(
			eventFor({
				pathname: '/p/valdoria-reach',
				userId: id,
				cookie: 'en',
				acceptLanguage: 'it-IT,it;q=0.9'
			})
		);
		expect(locale).toBe('it');

		const englishVisitor = await resolveLocale(
			eventFor({ pathname: '/p/valdoria-reach', userId: id, cookie: 'en', acceptLanguage: 'en-US' })
		);
		expect(englishVisitor).toBe('en');
	});
});
