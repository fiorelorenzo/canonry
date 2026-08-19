/**
 * `/auth/sign-in`: already signed in never sees this page again (redirected home), and
 * the social buttons only render for a provider that is actually configured - reading
 * `buildSocialProviders` here rather than hardcoding the list keeps this page honest
 * about what `$lib/server/auth.ts` actually wired up.
 *
 * `signIn` is a real form action (#262), for the same reason `/auth/sign-up`'s `signUp` is:
 * the form used to be `<form onsubmit={...}>` with no `method`, so a submit that arrived
 * before hydration was a GET to this URL with the email and the password in the query
 * string. `use:enhance` on the page is now the enhancement, and this is the
 * implementation, so the no-JavaScript path is a POST that works. `load` also refuses a
 * URL that still carries a password parameter.
 *
 * `setLocale` backs the compact switcher (issue #120, SPEC.md §17): there is no account
 * yet on this page, so the explicit choice goes in the `canonry_locale` cookie rather
 * than `user.locale` - see `/settings/language` for the signed-in equivalent.
 */
import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { env } from '$env/dynamic/private';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, messages, parseLocaleChoice } from '$lib/i18n';
import { auth, buildSocialProviders } from '$lib/server/auth';
import { formString, forwardAuthCookies, refuseCredentialQuery } from '$lib/server/auth-forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	refuseCredentialQuery(url);
	if (locals.user) redirect(303, '/');
	return { providers: Object.keys(buildSocialProviders(env)) };
};

export const actions: Actions = {
	signIn: async ({ request, cookies, locals }) => {
		const t = messages(locals.locale).auth.signIn;
		const formData = await request.formData();
		const email = formString(formData, 'email').trim();
		const password = formString(formData, 'password');
		if (email.length === 0 || password.length === 0) {
			return fail(400, { error: t.credentialsRequired, email });
		}

		try {
			const { headers } = await auth.api.signInEmail({
				body: { email, password },
				returnHeaders: true
			});
			forwardAuthCookies(headers, cookies);
		} catch (err) {
			// The email goes back so the field is not empty on a retry. The password never
			// does: it is the one value that must not be in a rendered page either.
			if (err instanceof APIError) {
				return fail(400, { error: err.message ?? t.signInFailed, email });
			}
			throw err;
		}
		redirect(303, '/');
	},
	setLocale: async ({ request, cookies }) => {
		const formData = await request.formData();
		const submitted = parseLocaleChoice(formData.get('locale'));
		if (!submitted) return fail(400);

		cookies.set(LOCALE_COOKIE, submitted, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE });
		return { locale: submitted };
	}
};
