/**
 * `/settings/language`: the account-wide interface locale (issue #120, SPEC.md §17),
 * persisted to `user.locale` through a form action so it follows the GM to the phone at
 * the table, unlike the theme/cookie-only preferences elsewhere in `settings/**`. No
 * account, no place to persist it - unauthenticated visitors get the same inline
 * sign-in prompt `/settings/billing` already uses, and pick their language from the
 * compact switcher on the auth pages instead, which sets a cookie (`negotiateLocale`'s
 * own second rung, for a visitor with no account yet).
 *
 * Writes go straight through `$lib/server/db` rather than Better Auth's `updateUser` API:
 * `$lib/server/auth.ts` does not declare `locale` as a Better Auth `additionalFields`
 * entry (see hooks.server.ts's `resolveLocale` doc comment for how that was confirmed),
 * so a direct, single-column update is both simpler and the only thing that actually
 * works today.
 */
import { fail } from '@sveltejs/kit';
import { eq } from '@canonry/db';
import { user } from '@canonry/db/schema';
import { messages, parseLocaleChoice } from '$lib/i18n';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { signedIn: false as const };

	const rows = await db()
		.select({ locale: user.locale })
		.from(user)
		.where(eq(user.id, locals.user.id))
		.limit(1);
	return { signedIn: true as const, accountLocale: rows[0]?.locale ?? null };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { error: messages(locals.locale).settings.language.signInPrompt });
		}

		const formData = await request.formData();
		const submitted = parseLocaleChoice(formData.get('locale'));
		if (!submitted) {
			return fail(400, { error: messages(locals.locale).settings.language.error });
		}

		await db().update(user).set({ locale: submitted }).where(eq(user.id, locals.user.id));
		return { accountLocale: submitted };
	}
};
