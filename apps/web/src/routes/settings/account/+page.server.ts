/**
 * `/settings/account` (#154): `load` computes `accountDeletionImpact` (@canonry/db) -
 * the cascade the delete section shows before its control is even usable, since
 * `universe.owner_user_id` is `ON DELETE CASCADE` and issue #154's own acceptance is a
 * GM reading the real numbers, not a generic warning. Zero for a signed-out request,
 * same guard `routes/+layout.server.ts` already uses for `universes`.
 *
 * `requestDeletion` is a server action, not a client `authClient.deleteUser()` call
 * like this page's name/password controls use (see `+page.svelte`'s own doc comment
 * for why those go through Better Auth's client API directly): only the server can
 * tell "the confirmation mail failed to send" apart from "it sent"
 * (`deleteAccountSendOutcome`, `$lib/server/mail/delete-account.ts`'s own doc comment),
 * the same reason `/auth/forgot-password`'s action exists instead of a client
 * `authClient.forgetPassword` call. It also passes the account's current password on
 * the same `/delete-user` call Better Auth verifies before it ever sends the mail -
 * issue #154's own decision that a hijacked session with neither the password nor the
 * inbox should get neither step.
 *
 * #277: same preflight `/auth/forgot-password` now carries. Nothing is deleted until the
 * emailed link is followed, so a confirmation that could never be sent is a dead end this
 * action should refuse before it asks Better Auth to verify a password, rather than
 * answering "verification email sent" over a send that threw.
 */
import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { accountDeletionImpact, type AccountDeletionImpact } from '@canonry/db';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { deleteAccountSendOutcome } from '$lib/server/mail/delete-account';
import { isMailTransportConfigured } from '$lib/server/mail/transport';
import { env } from '$env/dynamic/private';
import { messages } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

const NOTHING_TO_DESTROY: AccountDeletionImpact = {
	universes: 0,
	entities: 0,
	revisions: 0,
	proposals: 0,
	images: 0
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { deletionImpact: NOTHING_TO_DESTROY };
	return { deletionImpact: await accountDeletionImpact(db(), locals.user.id) };
};

export const actions: Actions = {
	requestDeletion: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const t = messages(locals.locale).settings.account;
		const formData = await request.formData();
		const password = formData.get('password');
		if (typeof password !== 'string' || password.length === 0) {
			return fail(400, { deleteError: t.deletePasswordRequired });
		}

		if (!isMailTransportConfigured(env)) {
			return fail(503, { deleteError: t.deleteSendFailed });
		}

		const outcome = { failed: false };
		try {
			await deleteAccountSendOutcome.run(outcome, () =>
				auth.api.deleteUser({
					headers: request.headers,
					body: { password, callbackURL: '/auth/account-deleted' }
				})
			);
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { deleteError: t.deleteWrongPassword });
			}
			throw err;
		}
		if (outcome.failed) {
			return fail(503, { deleteError: t.deleteSendFailed });
		}
		return { deleteRequested: true };
	}
};
