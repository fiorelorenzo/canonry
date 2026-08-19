/**
 * `guardMailSendingRequest` against the real senders (`makeSendResetPassword`,
 * `makeSendDeleteAccountVerification`), a real Postgres row for each account and a
 * `FakeMailTransport`, so what is under test is the whole chain #277 is about: a send
 * throws, the sender flips its own `AsyncLocalStorage` store, and the guard replaces the
 * answer Better Auth would otherwise have written. `serve` here stands in for
 * `auth.handler`, returning the exact body `POST /api/auth/request-password-reset`
 * answers, which is the response this issue exists to stop being a lie.
 *
 * The enumeration property gets its own test rather than a comment: the bytes an existing
 * address and an unknown address receive on a transport failure are compared directly.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, type Db } from '@canonry/db';
import { user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMailTransport } from './transport.js';
import { makeSendResetPassword } from './reset-password.js';
import { makeSendDeleteAccountVerification } from './delete-account.js';
import {
	guardMailSendingRequest,
	MAIL_UNAVAILABLE_CODE,
	MAIL_UNAVAILABLE_STATUS,
	mailSendingAuthPaths,
	mailUnavailableResponse
} from './send-guard.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

/** Better Auth 1.6.29's own answer to `POST /api/auth/request-password-reset`, quoted from
 * the response issue #277 recorded on preview. */
const HEDGE_BODY = JSON.stringify({
	status: true,
	message: 'If this email exists in our system, check your email for the reset link'
});

function hedge(): Response {
	return new Response(HEDGE_BODY, {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const RESET_URL =
	'https://canonry.test/api/auth/reset-password/tok277?callbackURL=%2Fauth%2Freset-password';

describe('guardMailSendingRequest (#277)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(DATABASE_URL, { max: 1 });
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('passes Better Auth\u2019s own answer through untouched when the send worked', async () => {
		const id = unique('guard-success');
		await db.insert(user).values({ id, name: 'Sends Fine', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport();
		const sendResetPassword = makeSendResetPassword({ db, transport });

		const response = await guardMailSendingRequest({
			configured: true,
			serve: async () => {
				await sendResetPassword({ user: { id, email: `${id}@test.canonry` }, url: RESET_URL });
				return hedge();
			}
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(HEDGE_BODY);
		expect(transport.sent).toHaveLength(1);
	});

	it('keeps the hedge for an address with no account: nothing was attempted, so nothing failed', async () => {
		const response = await guardMailSendingRequest({
			configured: true,
			// Better Auth never calls the sender for an address it has no row for, which is
			// exactly why the hedge is the right answer here and has to survive this change.
			serve: async () => hedge()
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(HEDGE_BODY);
	});

	it('replaces the hedge when the send threw, saying the mail could not be sent', async () => {
		const id = unique('guard-send-failed');
		await db.insert(user).values({ id, name: 'Transport Down', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport({ fail: true });
		const sendResetPassword = makeSendResetPassword({ db, transport });

		const response = await guardMailSendingRequest({
			configured: true,
			serve: async () => {
				await sendResetPassword({ user: { id, email: `${id}@test.canonry` }, url: RESET_URL });
				return hedge();
			}
		});

		expect(response.status).toBe(MAIL_UNAVAILABLE_STATUS);
		const body = (await response.json()) as { code: string; message: string };
		expect(body.code).toBe(MAIL_UNAVAILABLE_CODE);
		expect(body.message).toContain('could not be sent');
		expect(body.message).not.toContain('check your email');
	});

	it('replaces the answer the same way when the delete-account confirmation threw', async () => {
		const id = unique('guard-delete-failed');
		await db.insert(user).values({ id, name: 'Deleting', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport({ fail: true });
		const sendDeleteAccountVerification = makeSendDeleteAccountVerification({ db, transport });

		const response = await guardMailSendingRequest({
			configured: true,
			serve: async () => {
				await sendDeleteAccountVerification({
					user: { id, email: `${id}@test.canonry` },
					url: 'https://canonry.test/api/auth/delete-user/callback?token=tok277'
				});
				return new Response(JSON.stringify({ success: true, message: 'Verification email sent' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
		});

		expect(response.status).toBe(MAIL_UNAVAILABLE_STATUS);
		expect(await response.text()).toBe(await mailUnavailableResponse().text());
	});

	it('refuses an unconfigured transport without calling the handler at all, so no address is ever looked up', async () => {
		let served = false;

		const response = await guardMailSendingRequest({
			configured: false,
			serve: async () => {
				served = true;
				return hedge();
			}
		});

		expect(served).toBe(false);
		expect(response.status).toBe(MAIL_UNAVAILABLE_STATUS);
		expect(await response.text()).toBe(await mailUnavailableResponse().text());
	});

	it('answers an existing address and an unknown one with identical bytes when no transport is configured', async () => {
		const id = unique('guard-enumeration');
		await db.insert(user).values({ id, name: 'Real Account', email: `${id}@test.canonry` });
		const transport = new FakeMailTransport();
		const sendResetPassword = makeSendResetPassword({ db, transport });

		const forExisting = await guardMailSendingRequest({
			configured: false,
			serve: async () => {
				await sendResetPassword({ user: { id, email: `${id}@test.canonry` }, url: RESET_URL });
				return hedge();
			}
		});
		const forUnknown = await guardMailSendingRequest({
			configured: false,
			serve: async () => hedge()
		});

		expect(forExisting.status).toBe(forUnknown.status);
		expect(forExisting.headers.get('content-type')).toBe(forUnknown.headers.get('content-type'));
		expect(await forExisting.text()).toBe(await forUnknown.text());
		// Nothing distinguishing happened either: the refusal is decided before the send,
		// so the account that does exist was never mailed and never read.
		expect(transport.sent).toHaveLength(0);
	});

	it('carries a session cookie Better Auth set on the discarded response over to the refusal', async () => {
		const id = unique('guard-cookie');
		await db.insert(user).values({ id, name: 'Has Cookie', email: `${id}@test.canonry` });
		const sendResetPassword = makeSendResetPassword({
			db,
			transport: new FakeMailTransport({ fail: true })
		});

		const response = await guardMailSendingRequest({
			configured: true,
			serve: async () => {
				await sendResetPassword({ user: { id, email: `${id}@test.canonry` }, url: RESET_URL });
				return new Response(HEDGE_BODY, {
					status: 200,
					headers: {
						'content-type': 'application/json',
						'set-cookie': 'canonry.session_token=refreshed; Path=/; HttpOnly'
					}
				});
			}
		});

		expect(response.status).toBe(MAIL_UNAVAILABLE_STATUS);
		expect(response.headers.getSetCookie()).toEqual([
			'canonry.session_token=refreshed; Path=/; HttpOnly'
		]);
	});
});

describe('mailSendingAuthPaths (#277)', () => {
	it('prefixes each endpoint path with Better Auth\u2019s default base path', () => {
		const paths = mailSendingAuthPaths(undefined, [
			{ path: '/request-password-reset' },
			{ path: '/delete-user' }
		]);

		expect([...paths].sort()).toEqual([
			'/api/auth/delete-user',
			'/api/auth/request-password-reset'
		]);
	});

	it('honours a configured basePath, with or without a trailing slash', () => {
		expect([...mailSendingAuthPaths('/auth', [{ path: '/delete-user' }])]).toEqual([
			'/auth/delete-user'
		]);
		expect([...mailSendingAuthPaths('/auth/', [{ path: '/delete-user' }])]).toEqual([
			'/auth/delete-user'
		]);
	});
});
