/**
 * `/auth/sign-in`: already signed in never sees this page again (redirected home), and
 * the social buttons only render for a provider that is actually configured - reading
 * `buildSocialProviders` here rather than hardcoding the list keeps this page honest
 * about what `$lib/server/auth.ts` actually wired up.
 */
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { buildSocialProviders } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { providers: Object.keys(buildSocialProviders(env)) };
};
