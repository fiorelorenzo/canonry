/**
 * `/settings/keys`: bring your own key (SPEC.md §15, decision F3 = C/B - the settings
 * panel the contextual sentence links to). Issue #90.
 *
 * Every action re-checks `locals.user` at its own top: SvelteKit runs a form action
 * before any layout `load`, so a page-level `load` guard alone would not cover a POST
 * (the same rule `$lib/server/admin.ts`'s doc comment states for /admin's own actions).
 */
import { fail } from '@sveltejs/kit';
import { messages } from '$lib/i18n';
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
		const t = messages(locals.locale).settings.keys;
		if (!locals.user) return fail(401, { error: t.addSignInRequired });

		const formData = await request.formData();
		const provider = requireProvider(formData);
		if (!provider) {
			return fail(400, { error: t.addPickProvider });
		}
		const apiKey = formData.get('apiKey');
		if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
			return fail(400, { error: t.addPasteKey });
		}

		try {
			const stored = await addOrReplaceKey(locals.user.id, provider, apiKey.trim());
			return { saved: true, provider, lastFour: stored.lastFour };
		} catch (err) {
			// encryptApiKey's own "shorter than 8 characters" check, or a misconfigured
			// BYO_KEY_ENCRYPTION_KEY - either way the user sees why, never a raw stack trace,
			// and the plaintext they submitted never appears in the error. That thrown
			// message is server-config/crypto-library text, not interface copy, so only the
			// generic fallback below is catalogued.
			const message = err instanceof Error ? err.message : t.addSaveFailedFallback;
			return fail(400, { error: message });
		}
	},

	toggle: async ({ request, locals }) => {
		const t = messages(locals.locale).settings.keys;
		if (!locals.user) return fail(401, { error: t.toggleSignInRequired });

		const formData = await request.formData();
		const provider = requireProvider(formData);
		if (!provider) return fail(400, { error: t.unknownProvider });
		const active = formData.get('active') === 'true';

		await setKeyActive(locals.user.id, provider, active);
		return { toggled: true, provider, active };
	},

	remove: async ({ request, locals }) => {
		const t = messages(locals.locale).settings.keys;
		if (!locals.user) return fail(401, { error: t.removeSignInRequired });

		const formData = await request.formData();
		const provider = requireProvider(formData);
		if (!provider) return fail(400, { error: t.unknownProvider });

		await removeKey(locals.user.id, provider);
		return { removed: true, provider };
	}
};
