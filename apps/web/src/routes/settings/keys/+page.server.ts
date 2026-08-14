/**
 * `/settings/keys`: bring your own key (SPEC.md §15, decision F3 = C/B - the settings
 * panel the contextual sentence links to). Issue #90.
 *
 * Every action re-checks `locals.user` at its own top: SvelteKit runs a form action
 * before any layout `load`, so a page-level `load` guard alone would not cover a POST
 * (the same rule `$lib/server/admin.ts`'s doc comment states for /admin's own actions).
 */
import { fail } from '@sveltejs/kit';
import {
	addOrReplaceKey,
	BYO_KEY_PROVIDERS,
	isByoKeyProvider,
	listKeysForUser,
	removeKey,
	setKeyActive
} from '$lib/server/billing/keys';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { signedIn: false as const, keys: [] };

	const keys = await listKeysForUser(locals.user.id);
	return {
		signedIn: true as const,
		providers: BYO_KEY_PROVIDERS,
		keys: keys.map((key) => ({
			provider: key.provider,
			lastFour: key.lastFour,
			active: key.active,
			createdAt: key.createdAt,
			lastUsedAt: key.lastUsedAt
		}))
	};
};

function requireProvider(formData: FormData): string | null {
	const provider = formData.get('provider');
	if (typeof provider !== 'string' || !isByoKeyProvider(provider)) return null;
	return provider;
}

export const actions: Actions = {
	add: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Sign in to add a key.' });

		const formData = await request.formData();
		const provider = requireProvider(formData);
		if (!provider) {
			return fail(400, { error: 'Pick a provider from the list.' });
		}
		const apiKey = formData.get('apiKey');
		if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
			return fail(400, { error: 'Paste the key before saving.' });
		}

		try {
			const stored = await addOrReplaceKey(locals.user.id, provider, apiKey.trim());
			return { saved: true, provider, lastFour: stored.lastFour };
		} catch (err) {
			// encryptApiKey's own "shorter than 8 characters" check, or a misconfigured
			// BYO_KEY_ENCRYPTION_KEY - either way the user sees why, never a raw stack trace,
			// and the plaintext they submitted never appears in the error.
			const message = err instanceof Error ? err.message : 'Could not save that key.';
			return fail(400, { error: message });
		}
	},

	toggle: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Sign in to change a key.' });

		const formData = await request.formData();
		const provider = requireProvider(formData);
		if (!provider) return fail(400, { error: 'Unknown provider.' });
		const active = formData.get('active') === 'true';

		await setKeyActive(locals.user.id, provider, active);
		return { toggled: true, provider, active };
	},

	remove: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Sign in to remove a key.' });

		const formData = await request.formData();
		const provider = requireProvider(formData);
		if (!provider) return fail(400, { error: 'Unknown provider.' });

		await removeKey(locals.user.id, provider);
		return { removed: true, provider };
	}
};
