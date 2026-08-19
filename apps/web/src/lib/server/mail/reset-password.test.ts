/**
 * `makeSendResetPassword` against a real Postgres row for locale (same convention as
 * `hooks.server.test.ts`'s own account-preference tests) and a `FakeMailTransport` -
 * never the real Resend API, per #151's own instruction ("tests use a fake transport").
 * Covers the localized composition, and the loud-failure contract `resetSendOutcome`
 * exists for: a form action running the whole call inside `resetSendOutcome.run` sees
 * `failed: true` when the transport throws, instead of Better Auth's own
 * `runInBackgroundOrAwait` silently swallowing it.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, type Db } from '@canonry/db';
import { user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMailTransport } from './transport.js';
import { makeSendResetPassword, resetSendOutcome } from './reset-password.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('makeSendResetPassword (#151)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 1 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('sends a localized mail, with the reset url, to the account holding the requested address', async () => {
		const id = unique('reset-password-it');
		await db
			.insert(user)
			.values({ id, name: 'Locale Holder', email: `${id}@test.canonry`, locale: 'it' });
		const transport = new FakeMailTransport();
		const sendResetPassword = makeSendResetPassword({ db, transport });
		const url = `https://canonry.test/api/auth/reset-password/tok123?callbackURL=%2Fauth%2Freset-password`;

		await sendResetPassword({ user: { id, email: `${id}@test.canonry` }, url });

		expect(transport.sent).toHaveLength(1);
		expect(transport.sent[0]?.to).toBe(`${id}@test.canonry`);
		expect(transport.sent[0]?.subject).toBe('Reimposta la tua password Canonry');
		expect(transport.sent[0]?.text).toContain(url);
		expect(transport.sent[0]?.html).toContain(url);
	});

	it('falls back to English for an account with no saved locale preference', async () => {
		const id = unique('reset-password-default');
		await db.insert(user).values({ id, name: 'No Preference', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport();
		const sendResetPassword = makeSendResetPassword({ db, transport });

		await sendResetPassword({
			user: { id, email: `${id}@test.canonry` },
			url: 'https://canonry.test/api/auth/reset-password/tok456?callbackURL=%2Fauth%2Freset-password'
		});

		expect(transport.sent[0]?.subject).toBe('Reset your Canonry password');
	});

	it('marks the AsyncLocalStorage outcome as failed, and never throws to the caller, when the transport fails inside resetSendOutcome.run', async () => {
		const id = unique('reset-password-failure');
		await db.insert(user).values({ id, name: 'Failure Path', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport({ fail: true });
		const sendResetPassword = makeSendResetPassword({ db, transport });

		const outcome = { failed: false };
		await resetSendOutcome.run(outcome, () =>
			sendResetPassword({
				user: { id, email: `${id}@test.canonry` },
				url: 'https://canonry.test/api/auth/reset-password/tok789?callbackURL=%2Fauth%2Freset-password'
			})
		);

		expect(outcome.failed).toBe(true);
		expect(transport.sent).toEqual([]);
	});

	it('rethrows when the transport fails outside any resetSendOutcome.run (no swallow-by-default)', async () => {
		const id = unique('reset-password-failure-no-store');
		await db.insert(user).values({ id, name: 'No Store', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport({ fail: true });
		const sendResetPassword = makeSendResetPassword({ db, transport });

		await expect(
			sendResetPassword({
				user: { id, email: `${id}@test.canonry` },
				url: 'https://canonry.test/api/auth/reset-password/tokabc?callbackURL=%2Fauth%2Freset-password'
			})
		).rejects.toThrow();
	});

	it('a successful send inside resetSendOutcome.run leaves the outcome unmarked', async () => {
		const id = unique('reset-password-success-in-store');
		await db.insert(user).values({ id, name: 'Success In Store', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport();
		const sendResetPassword = makeSendResetPassword({ db, transport });

		const outcome = { failed: false };
		await resetSendOutcome.run(outcome, () =>
			sendResetPassword({
				user: { id, email: `${id}@test.canonry` },
				url: 'https://canonry.test/api/auth/reset-password/tokdef?callbackURL=%2Fauth%2Freset-password'
			})
		);

		expect(outcome.failed).toBe(false);
		expect(transport.sent).toHaveLength(1);
	});
});
