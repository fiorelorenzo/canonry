/**
 * `/auth/account-deleted` (#154): where Better Auth's `/delete-user/callback` redirects
 * once the emailed link actually deletes the account - `+page.server.ts`'s
 * `requestDeletion` action passes `callbackURL: '/auth/account-deleted'` on the same
 * shape `/auth/forgot-password`'s `redirectTo: '/auth/reset-password'` already uses.
 * No `load`: the account is gone by the time this renders, so there is nothing left to
 * check a session against. `setLocale` mirrors sign-in/sign-up/forgot-password/reset-
 * password's own identical action - `AuthShell`'s footer renders `LocaleSwitcher` on
 * every auth page, which always posts to `?/setLocale` on whichever page it is on.
 */
import { fail } from '@sveltejs/kit';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, parseLocaleChoice } from '$lib/i18n';
import type { Actions } from './$types';

export const actions: Actions = {
	setLocale: async ({ request, cookies }) => {
		const formData = await request.formData();
		const submitted = parseLocaleChoice(formData.get('locale'));
		if (!submitted) return fail(400);

		cookies.set(LOCALE_COOKIE, submitted, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE });
		return { locale: submitted };
	}
};
