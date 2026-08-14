/**
 * `/auth/sign-up`: same shape as `/auth/sign-in`'s server load - already signed in
 * skips straight past this page, and the social buttons only list what is actually
 * configured.
 */
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { buildSocialProviders } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { providers: Object.keys(buildSocialProviders(env)) };
};
