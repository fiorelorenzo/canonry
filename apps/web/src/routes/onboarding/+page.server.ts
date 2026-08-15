/**
 * Issue #108, D7 = A's screen: name a universe, then choose a start. Issue #142, I4 = B
 * ("one creation surface", docs/ux/DECISIONS.md) folded /u/new's standalone empty-universe
 * form into this route as a third action rather than a second door - `empty` below is the
 * same createOnboardingUniverse call /u/new used to make, just reachable from here now.
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

	empty: async ({ request, locals }) => {
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
		redirect(303, `/u/${created.slug}`);
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
