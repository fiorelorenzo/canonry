/**
 * `makeSendDeleteAccountVerification` against a real Postgres row for locale (same
 * convention as `reset-password.test.ts`, #151) and a `FakeMailTransport` - never the
 * real Resend API. Covers the localized composition, and the loud-failure contract
 * `deleteAccountSendOutcome` exists for: a form action running the whole call inside
 * `deleteAccountSendOutcome.run` sees `failed: true` when the transport throws, instead
 * of Better Auth's own `runInBackgroundOrAwait` silently swallowing it (#154).
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, type Db } from '@canonry/db';
import { user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMailTransport } from './transport.js';
import { deleteAccountSendOutcome, makeSendDeleteAccountVerification } from './delete-account.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('makeSendDeleteAccountVerification (#154)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 1 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('sends a localized mail, with the delete-confirmation url, to the account being deleted', async () => {
		const id = unique('delete-account-it');
		await db
			.insert(user)
			.values({ id, name: 'Locale Holder', email: `${id}@test.canonry`, locale: 'it' });
		const transport = new FakeMailTransport();
		const sendDeleteAccountVerification = makeSendDeleteAccountVerification({ db, transport });
		const url = `https://canonry.test/api/auth/delete-user/callback?token=tok123&callbackURL=%2Fauth%2Faccount-deleted`;

		await sendDeleteAccountVerification({ user: { id, email: `${id}@test.canonry` }, url });

		expect(transport.sent).toHaveLength(1);
		expect(transport.sent[0]?.to).toBe(`${id}@test.canonry`);
		expect(transport.sent[0]?.subject).toBe("Conferma l'eliminazione del tuo account Canonry");
		expect(transport.sent[0]?.text).toContain(url);
		// The plain-text body carries the url verbatim; the html body carries it through
		// `escapeHtml`, which turns `&` into `&amp;` - real, since a real delete-user
		// callback url is `.../delete-user/callback?token=...&callbackURL=...`, two query
		// params joined by `&` (better-auth/dist/api/routes/update-user.mjs).
		expect(transport.sent[0]?.html).toContain(url.replace(/&/g, '&amp;'));
	});

	it('falls back to English for an account with no saved locale preference', async () => {
		const id = unique('delete-account-default');
		await db.insert(user).values({ id, name: 'No Preference', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport();
		const sendDeleteAccountVerification = makeSendDeleteAccountVerification({ db, transport });

		await sendDeleteAccountVerification({
			user: { id, email: `${id}@test.canonry` },
			url: 'https://canonry.test/api/auth/delete-user/callback?token=tok456&callbackURL=%2Fauth%2Faccount-deleted'
		});

		expect(transport.sent[0]?.subject).toBe('Confirm deleting your Canonry account');
	});

	it('marks the AsyncLocalStorage outcome as failed, and never throws to the caller, when the transport fails inside deleteAccountSendOutcome.run', async () => {
		const id = unique('delete-account-failure');
		await db.insert(user).values({ id, name: 'Failure Path', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport({ fail: true });
		const sendDeleteAccountVerification = makeSendDeleteAccountVerification({ db, transport });

		const outcome = { failed: false };
		await deleteAccountSendOutcome.run(outcome, () =>
			sendDeleteAccountVerification({
				user: { id, email: `${id}@test.canonry` },
				url: 'https://canonry.test/api/auth/delete-user/callback?token=tok789&callbackURL=%2Fauth%2Faccount-deleted'
			})
		);

		expect(outcome.failed).toBe(true);
		expect(transport.sent).toEqual([]);
	});

	it('rethrows when the transport fails outside any deleteAccountSendOutcome.run (no swallow-by-default)', async () => {
		const id = unique('delete-account-failure-no-store');
		await db.insert(user).values({ id, name: 'No Store', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport({ fail: true });
		const sendDeleteAccountVerification = makeSendDeleteAccountVerification({ db, transport });

		await expect(
			sendDeleteAccountVerification({
				user: { id, email: `${id}@test.canonry` },
				url: 'https://canonry.test/api/auth/delete-user/callback?token=tokabc&callbackURL=%2Fauth%2Faccount-deleted'
			})
		).rejects.toThrow();
	});

	it('a successful send inside deleteAccountSendOutcome.run leaves the outcome unmarked', async () => {
		const id = unique('delete-account-success-in-store');
		await db.insert(user).values({ id, name: 'Success In Store', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport();
		const sendDeleteAccountVerification = makeSendDeleteAccountVerification({ db, transport });

		const outcome = { failed: false };
		await deleteAccountSendOutcome.run(outcome, () =>
			sendDeleteAccountVerification({
				user: { id, email: `${id}@test.canonry` },
				url: 'https://canonry.test/api/auth/delete-user/callback?token=tokdef&callbackURL=%2Fauth%2Faccount-deleted'
			})
		);

		expect(outcome.failed).toBe(false);
		expect(transport.sent).toHaveLength(1);
	});
});
