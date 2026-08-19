/**
 * `/auth/reset-password` (#151): where the mail's link lands, `?token=<token>` appended by
 * Better Auth's own `/api/auth/reset-password/:token` redirect (see
 * `$lib/server/mail/reset-password.ts`'s doc comment for the request side of this flow).
 *
 * `resetPassword` is a real form action (#262). It used to run client-side through
 * `authClient.resetPassword` behind `<form onsubmit={...}>` with no `method`, so a submit
 * before hydration was a GET carrying `newPassword` and `confirmPassword` in the query
 * string - the same defect the sign-up page had, on a page whose whole purpose is choosing
 * a password. Better Auth's real API error (an expired token, a password that is too
 * short) still reaches the reader: it arrives here as an `APIError` and goes back as the
 * form's own error, never silently swallowed the way a transport failure is
 * (`runInBackgroundOrAwait` only ever wraps `sendResetPassword`, never `resetPassword`).
 *
 * The token comes from a hidden field rather than from `url.searchParams`, so the action
 * does not depend on the query surviving the POST. `load` refuses a URL that carries a
 * password parameter, keeping the token, which is what that page still needs.
 *
 * `setLocale`: AuthShell's footer renders `LocaleSwitcher` on every auth page (#139),
 * which always posts to `?/setLocale` on whichever page it is on - mirrors
 * sign-in/sign-up/forgot-password's own identical action.
 */
import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, messages, parseLocaleChoice } from '$lib/i18n';
import { auth } from '$lib/server/auth';
import { refuseCredentialQuery } from '$lib/server/auth-forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	refuseCredentialQuery(url);
};

export const actions: Actions = {
	resetPassword: async ({ request, locals }) => {
		const t = messages(locals.locale).auth.resetPassword;
		const formData = await request.formData();
		const token = formData.get('token');
		const newPassword = formData.get('newPassword');
		const confirmPassword = formData.get('confirmPassword');
		if (typeof token !== 'string' || token.length === 0) {
			return fail(400, { error: t.invalidToken });
		}
		if (
			typeof newPassword !== 'string' ||
			newPassword.length === 0 ||
			typeof confirmPassword !== 'string'
		) {
			return fail(400, { error: t.passwordRequired });
		}
		if (newPassword !== confirmPassword) {
			return fail(400, { error: t.passwordMismatch });
		}

		try {
			await auth.api.resetPassword({ body: { newPassword, token } });
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { error: err.message ?? t.invalidToken });
			}
			throw err;
		}
		return { success: true };
	},
	setLocale: async ({ request, cookies }) => {
		const formData = await request.formData();
		const submitted = parseLocaleChoice(formData.get('locale'));
		if (!submitted) return fail(400);

		cookies.set(LOCALE_COOKIE, submitted, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE });
		return { locale: submitted };
	}
};
