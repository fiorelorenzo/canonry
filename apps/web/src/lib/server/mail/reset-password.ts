/**
 * Wires Better Auth's `sendResetPassword` (#151) to `./transport.ts`'s `MailTransport`,
 * and answers the one problem wiring it directly could not solve on its own: Better
 * Auth's own `runInBackgroundOrAwait` (`node_modules/better-auth/dist/context/
 * create-context.mjs`) awaits whatever `sendResetPassword` returns, catches anything it
 * throws, logs it through Better Auth's own logger, and then still answers the
 * `/request-password-reset` endpoint with `{status: true, ...}` regardless - deliberate,
 * for the case "no account has this address" (answering the same either way is what
 * stops that endpoint being used to enumerate accounts), and exactly wrong for "the
 * transport is down": nobody should see a green "check your inbox" over a mail that
 * never left (#151's own acceptance criteria).
 *
 * `resetSendOutcome` is how the forgot-password form action tells the two cases apart
 * without Better Auth ever knowing this exists: it runs the whole
 * `auth.api.requestPasswordReset(...)` call inside `resetSendOutcome.run(outcome, ...)`,
 * and `makeSendResetPassword`'s returned function flips `outcome.failed` on that same
 * store when the actual send throws. Node's `AsyncLocalStorage` carries the store across
 * every `await` in between because nothing here configures Better Auth's
 * `advanced.backgroundTasks.handler` - `runInBackgroundOrAwait` therefore just
 * `await`s the promise in place, so the whole chain runs on one continuous async
 * context, the same one the form action started.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, type Db } from '@canonry/db';
import { user as userTable } from '@canonry/db/schema';
import { DEFAULT_LOCALE, isLocale, messages, type Locale, type Messages } from '$lib/i18n';
import type { MailTransport } from './transport.js';

export interface ResetSendOutcome {
	failed: boolean;
}

export const resetSendOutcome = new AsyncLocalStorage<ResetSendOutcome>();

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function resetPasswordText(t: Messages['mail']['passwordReset'], url: string): string {
	return [t.body, '', t.linkFallback, url, '', t.expiryNotice, t.ignoreNotice].join('\n');
}

function resetPasswordHtml(t: Messages['mail']['passwordReset'], url: string): string {
	const safeUrl = escapeHtml(url);
	return [
		`<p>${escapeHtml(t.body)}</p>`,
		`<p><a href="${safeUrl}">${escapeHtml(t.button)}</a></p>`,
		`<p>${escapeHtml(t.linkFallback)} ${safeUrl}</p>`,
		`<p>${escapeHtml(t.expiryNotice)}</p>`,
		`<p>${escapeHtml(t.ignoreNotice)}</p>`
	].join('\n');
}

/** Which locale the mail is written in: the account's own stored preference
 * (`user.locale`, SPEC.md §17) when one has been chosen, English otherwise - Better
 * Auth's own `User` type carries no `locale` field (`$lib/server/auth.ts` declares no
 * `additionalFields` for it, see `hooks.server.ts`'s `resolveLocale` doc comment), so
 * this reads the same single column hooks.server.ts already does, directly, rather than
 * trusting a session payload that was never told about it. */
async function localeForUser(db: Db, userId: string): Promise<Locale> {
	const rows = await db
		.select({ locale: userTable.locale })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.limit(1);
	const stored = rows[0]?.locale;
	return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export interface MakeSendResetPasswordDeps {
	db: Db;
	transport: MailTransport;
}

/** Better Auth's own `sendResetPassword` shape: `(data: {user, url, token}, request?)
 * => Promise<void>`. */
export function makeSendResetPassword(
	deps: MakeSendResetPasswordDeps
): (data: { user: { id: string; email: string }; url: string }) => Promise<void> {
	return async ({ user, url }) => {
		const locale = await localeForUser(deps.db, user.id);
		const t = messages(locale).mail.passwordReset;
		try {
			await deps.transport.send({
				to: user.email,
				subject: t.subject,
				text: resetPasswordText(t, url),
				html: resetPasswordHtml(t, url)
			});
		} catch (err) {
			// Loud, per #151: logged here (never silently retried or dropped), and surfaced
			// to whichever form action is running inside `resetSendOutcome.run` - see this
			// module's own doc comment for why Better Auth's own error handling cannot do
			// that on its own.
			console.error('password reset mail failed to send:', err);
			const outcome = resetSendOutcome.getStore();
			if (outcome) {
				outcome.failed = true;
				return;
			}
			throw err;
		}
	};
}
