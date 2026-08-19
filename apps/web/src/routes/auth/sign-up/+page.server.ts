/**
 * `/auth/sign-up`: same shape as `/auth/sign-in`'s server load - already signed in
 * skips straight past this page, and the social buttons only list what is actually
 * configured.
 *
 * `signUp` is a real form action, and that is the whole of issue #262. This page used to
 * create the account from a client `authClient.signUp.email` call behind
 * `<form onsubmit={...}>`, with no `method` on the form, so a submit that arrived before
 * the page had hydrated was a GET to this same URL with the name, the email and the
 * password in the query string. The form now posts, so the browser sends a POST with no
 * JavaScript involved at all, and this action is what answers it; `use:enhance` on the
 * page is the enhancement rather than the only implementation. `load` also refuses a URL
 * that still carries a password parameter, which is the leak already sitting in somebody's
 * history rather than a new one.
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
	signUp: async ({ request, cookies, locals }) => {
		const t = messages(locals.locale).auth.signUp;
		const formData = await request.formData();
		const name = formString(formData, 'name').trim();
		const email = formString(formData, 'email').trim();
		const password = formString(formData, 'password');
		if (name.length === 0 || email.length === 0 || password.length === 0) {
			return fail(400, { error: t.fieldsRequired, name, email });
		}

		try {
			const { headers } = await auth.api.signUpEmail({
				body: { name, email, password },
				returnHeaders: true
			});
			forwardAuthCookies(headers, cookies);
		} catch (err) {
			// Better Auth's own message is request-time text from a library, not interface copy
			// this app authors, so it is shown as-is when there is one - the same call
			// `/settings/account`'s `requestDeletion` already makes. Never the submitted
			// values: what goes back to the page below is the name and the email, never the
			// password, because a re-render that carries it is one `value=` away from putting
			// it back on the wire.
			if (err instanceof APIError) {
				return fail(400, { error: err.message ?? t.signUpFailed, name, email });
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
