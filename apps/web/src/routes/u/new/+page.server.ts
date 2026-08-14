/**
 * Issue #108's other half: universe creation had no UI anywhere before this issue.
 * Standalone, reachable any time by a signed-in user who wants another universe outside
 * the onboarding sequence - /onboarding's own "name your universe" screen calls the same
 * createOnboardingUniverse function, this route is just its general-purpose front door.
 */
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createOnboardingUniverse, UniverseNameRequiredError } from '$lib/server/onboarding';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/auth/sign-in');
		const data = await request.formData();
		const name = String(data.get('name') ?? '');

		let created;
		try {
			created = await createOnboardingUniverse(db(), {
				userId: locals.user.id,
				name,
				kind: 'homebrew'
			});
		} catch (err) {
			if (err instanceof UniverseNameRequiredError) {
				return fail(400, { error: 'Name your universe first.', name });
			}
			throw err;
		}
		redirect(303, `/u/${created.slug}`);
	}
};
