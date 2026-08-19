/**
 * Wires Better Auth's `user.deleteUser.sendDeleteAccountVerification` (#154) to
 * `./transport.ts`'s `MailTransport`, the same shape `./reset-password.ts` already
 * carries for `sendResetPassword` - see that module's own doc comment for the problem
 * both solve identically: `/delete-user`'s handler calls
 * `sendDeleteAccountVerification` through the same `ctx.context.runInBackgroundOrAwait`
 * that reset password uses (`node_modules/better-auth/dist/api/routes/update-user.mjs`),
 * which awaits the promise, swallows anything it throws into its own logger, and still
 * answers `/settings/account`'s form action with `{success: true, message: "Verification
 * email sent"}` regardless. Without `deleteAccountSendOutcome` the action would have no
 * way to tell a real send from a mail that never left - the same green-check-over-a-dead-
 * mail bug #151 already ruled out for password reset.
 *
 * `apps/web/src/routes/settings/account/+page.server.ts`'s `requestDeletion` action runs
 * the whole `auth.api.deleteUser(...)` call inside `deleteAccountSendOutcome.run(outcome,
 * ...)`, on the same continuous async context `AsyncLocalStorage` needs - nothing here
 * configures Better Auth's `advanced.backgroundTasks.handler`, so `runInBackgroundOrAwait`
 * just awaits in place rather than detaching onto a separate task.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, type Db } from '@canonry/db';
import { user as userTable } from '@canonry/db/schema';
import { DEFAULT_LOCALE, isLocale, messages, type Locale } from '$lib/i18n';
import type { MailTransport } from './transport.js';

export interface DeleteAccountSendOutcome {
	failed: boolean;
}

export const deleteAccountSendOutcome = new AsyncLocalStorage<DeleteAccountSendOutcome>();

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Same reasoning as `./reset-password.ts`'s own `localeForUser`: the account's stored
 * preference (`user.locale`, SPEC.md §17), English otherwise. Read directly rather than
 * trusting a session payload that was never told about the column (`$lib/server/auth.ts`
 * declares no `additionalFields` for it). */
async function localeForUser(db: Db, userId: string): Promise<Locale> {
	const rows = await db
		.select({ locale: userTable.locale })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.limit(1);
	const stored = rows[0]?.locale;
	return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export interface MakeSendDeleteAccountVerificationDeps {
	db: Db;
	transport: MailTransport;
}

/** Better Auth's own `sendDeleteAccountVerification` shape: `(data: {user, url, token},
 * request?) => Promise<void>`. */
export function makeSendDeleteAccountVerification(
	deps: MakeSendDeleteAccountVerificationDeps
): (data: { user: { id: string; email: string }; url: string }) => Promise<void> {
	return async ({ user, url }) => {
		const locale = await localeForUser(deps.db, user.id);
		const t = messages(locale).mail.deleteAccount;
		const safeUrl = escapeHtml(url);
		try {
			await deps.transport.send({
				to: user.email,
				subject: t.subject,
				text: [t.body, '', t.linkFallback, url, '', t.expiryNotice, t.ignoreNotice].join('\n'),
				html: [
					`<p>${escapeHtml(t.body)}</p>`,
					`<p><a href="${safeUrl}">${escapeHtml(t.button)}</a></p>`,
					`<p>${escapeHtml(t.linkFallback)} ${safeUrl}</p>`,
					`<p>${escapeHtml(t.expiryNotice)}</p>`,
					`<p>${escapeHtml(t.ignoreNotice)}</p>`
				].join('\n')
			});
		} catch (err) {
			// Loud, per #151's own precedent: logged here, never silently retried or
			// dropped, and surfaced to whichever form action is running inside
			// `deleteAccountSendOutcome.run` - see this module's own doc comment for why
			// Better Auth's own error handling cannot do that on its own.
			console.error('delete-account mail failed to send:', err);
			const outcome = deleteAccountSendOutcome.getStore();
			if (outcome) {
				outcome.failed = true;
				return;
			}
			throw err;
		}
	};
}
