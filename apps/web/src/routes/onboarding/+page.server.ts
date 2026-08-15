/**
 * Issue #108, D7 = A's first screen: name a universe, then choose to import (the default
 * path, which continues at /onboarding/import) or, for a GM with nothing to import yet,
 * start from the pre-indexed universe (D7's real fallback, not an inert link).
 */
import { fail, redirect } from '@sveltejs/kit';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import {
	createOnboardingUniverse,
	findPreIndexedBaseUniverse,
	UniverseNameRequiredError
} from '$lib/server/onboarding';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');

	const preIndexedBase = await findPreIndexedBaseUniverse(db());
	return {
		preIndexedBase: preIndexedBase ? { name: preIndexedBase.name, slug: preIndexedBase.slug } : null
	};
};

export const actions: Actions = {
	import: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/auth/sign-in');
		const userId = locals.user.id;
		const data = await request.formData();
		const name = String(data.get('name') ?? '');

		let created;
		try {
			created = await createOnboardingUniverse(db(), { userId, name, kind: 'homebrew' });
		} catch (err) {
			if (err instanceof UniverseNameRequiredError) {
				return fail(400, { error: messages(locals.locale).import.start.errors.nameRequired, name });
			}
			throw err;
		}
		redirect(303, `/onboarding/import?universe=${created.slug}`);
	},

	preindexed: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/auth/sign-in');
		const userId = locals.user.id;
		const data = await request.formData();
		const name = String(data.get('name') ?? '');

		const database = db();
		const base = await findPreIndexedBaseUniverse(database);
		if (!base) {
			return fail(400, {
				error: messages(locals.locale).import.start.preindexedCard.notConfigured,
				name
			});
		}

		let created;
		try {
			created = await createOnboardingUniverse(database, {
				userId,
				name,
				kind: 'derived',
				baseUniverseId: base.id
			});
		} catch (err) {
			if (err instanceof UniverseNameRequiredError) {
				return fail(400, { error: messages(locals.locale).import.start.errors.nameRequired, name });
			}
			throw err;
		}
		redirect(303, `/u/${created.slug}`);
	}
};
