/**
 * `/settings/appearance`: the light/dark/system preference (G1 = B), set through a
 * form action so it works with JavaScript off, and read back through `await parent()`
 * (root `+layout.server.ts` already parsed the cookie for the request).
 */
import { fail } from '@sveltejs/kit';
import { isThemePreference, THEME_COOKIE } from '$lib/theme';
import type { Actions, PageServerLoad } from './$types';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const load: PageServerLoad = async ({ parent }) => {
	const { themePreference } = await parent();
	return { themePreference };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const submitted = formData.get('preference');
		if (typeof submitted !== 'string' || !isThemePreference(submitted)) {
			return fail(400, { error: 'Pick light, dark or match system.' });
		}

		cookies.set(THEME_COOKIE, submitted, { path: '/', maxAge: ONE_YEAR_SECONDS });
		return { themePreference: submitted };
	}
};
