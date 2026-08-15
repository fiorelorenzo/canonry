/**
 * `/auth/sign-in`: already signed in never sees this page again (redirected home), and
 * the social buttons only render for a provider that is actually configured - reading
 * `buildSocialProviders` here rather than hardcoding the list keeps this page honest
 * about what `$lib/server/auth.ts` actually wired up.
 *
 * `setLocale` backs the compact switcher (issue #120, SPEC.md §17): there is no account
 * yet on this page, so the explicit choice goes in the `canonry_locale` cookie rather
 * than `user.locale` - see `/settings/language` for the signed-in equivalent.
 */
import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, parseLocaleChoice } from '$lib/i18n';
import { buildSocialProviders } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { providers: Object.keys(buildSocialProviders(env)) };
};

export const actions: Actions = {
	setLocale: async ({ request, cookies }) => {
		const formData = await request.formData();
		const submitted = parseLocaleChoice(formData.get('locale'));
		if (!submitted) return fail(400);

		cookies.set(LOCALE_COOKIE, submitted, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE });
		return { locale: submitted };
	}
};
