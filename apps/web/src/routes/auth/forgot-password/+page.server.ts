/**
 * `/auth/forgot-password` (#151): the screen `/auth/sign-in`'s "Forgotten password?"
 * link points at. A server action rather than a client `authClient.forgetPassword` call
 * like sign-in/sign-up use for their own submit - the whole point of this screen is
 * telling "no such account" (Better Auth answers the same either way, on purpose, to
 * resist enumeration) apart from "the transport is down" (#151's own "never a green
 * check-your-inbox over a mail that never left"), and that distinction only exists on
 * the server, inside `resetSendOutcome.run` (`$lib/server/mail/reset-password.ts`'s own
 * doc comment explains why Better Auth's client/HTTP layer cannot see it either way).
 */
import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { resetSendOutcome } from '$lib/server/mail/reset-password';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, messages, parseLocaleChoice } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	requestReset: async ({ request, locals }) => {
		const t = messages(locals.locale).auth.forgotPassword;
		const formData = await request.formData();
		const email = formData.get('email');
		if (typeof email !== 'string' || email.trim().length === 0) {
			return fail(400, { error: t.emailRequired });
		}

		const outcome = { failed: false };
		await resetSendOutcome.run(outcome, () =>
			auth.api.requestPasswordReset({
				body: { email: email.trim(), redirectTo: '/auth/reset-password' }
			})
		);
		if (outcome.failed) {
			return fail(502, { error: t.sendFailed });
		}
		return { success: true };
	},
	// AuthShell's footer renders LocaleSwitcher on every auth page (#139), which always
	// posts to `?/setLocale` on whichever page it is on - mirrors sign-in/sign-up's own
	// identical action.
	setLocale: async ({ request, cookies }) => {
		const formData = await request.formData();
		const submitted = parseLocaleChoice(formData.get('locale'));
		if (!submitted) return fail(400);

		cookies.set(LOCALE_COOKIE, submitted, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE });
		return { locale: submitted };
	}
};
