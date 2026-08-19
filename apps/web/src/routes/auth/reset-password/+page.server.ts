/**
 * `/auth/reset-password` (#151): no `load`, no reset action of its own - the actual
 * reset runs client-side through `authClient.resetPassword` (see the page's own script
 * doc comment for why). The one thing this route still needs server-side: AuthShell's
 * footer renders `LocaleSwitcher` on every auth page (#139), which always posts to
 * `?/setLocale` on whichever page it is on - mirrors sign-in/sign-up/forgot-password's
 * own identical action.
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
