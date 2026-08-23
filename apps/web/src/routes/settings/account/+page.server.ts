/**
 * `/settings/account` (#154): `load` computes `accountDeletionImpact` (@canonry/db) -
 * the cascade the delete section shows before its control is even usable, since
 * `universe.owner_user_id` is `ON DELETE CASCADE` and issue #154's own acceptance is a
 * GM reading the real numbers, not a generic warning. Zero for a signed-out request,
 * same guard `routes/+layout.server.ts` already uses for `universes`.
 *
 * All three controls here are server actions. `requestDeletion` always was: only the server
 * can tell "the confirmation mail failed to send" apart from "it sent"
 * (`deleteAccountSendOutcome`, `$lib/server/mail/delete-account.ts`'s own doc comment), the
 * same reason `/auth/forgot-password`'s action exists instead of a client
 * `authClient.forgetPassword` call. It also passes the account's current password on the
 * same `/delete-user` call Better Auth verifies before it ever sends the mail - issue #154's
 * own decision that a hijacked session with neither the password nor the inbox should get
 * neither step.
 *
 * #277: same preflight `/auth/forgot-password` now carries. Nothing is deleted until the
 * emailed link is followed, so a confirmation that could never be sent is a dead end this
 * action should refuse before it asks Better Auth to verify a password, rather than
 * answering "verification email sent" over a send that threw. It answers the same 503 with
 * the same body an address with no account gets, so a missing `RESEND_API_KEY` is not an
 * oracle.
 *
 * `saveName` and `changePassword` became actions in #262, which was about the sign-up form
 * putting a password in a query string. These two forms had the same shape (`onsubmit` with
 * no `method`, a client `authClient.updateUser`/`changePassword` call as the only
 * implementation) and leaked nothing only because their inputs happened to carry no `name`
 * attribute, which is one attribute away from the same defect and is not a guard anybody
 * would recognise as one. They post now, so a submit before hydration is a POST that works
 * rather than a GET, and the password fields can carry a `name` like every other field in
 * the app. Neither of them sends mail, so neither carries the preflight above.
 */
import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import {
	accountDeletionImpact,
	clearUserHandle,
	handleForUser,
	setUserHandle,
	type AccountDeletionImpact
} from '@canonry/db';
import { auth } from '$lib/server/auth';
import { forwardAuthCookies } from '$lib/server/auth-forms';
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
	if (!locals.user) return { deletionImpact: NOTHING_TO_DESTROY, handle: null };
	// Two reads rather than one: `accountDeletionImpact` is five counts across five tables and
	// `handleForUser` is a single-column primary-key lookup, so running them together costs
	// the slower of the two rather than their sum.
	const [deletionImpact, handle] = await Promise.all([
		accountDeletionImpact(db(), locals.user.id),
		handleForUser(db(), locals.user.id)
	]);
	return { deletionImpact, handle };
};

export const actions: Actions = {
	saveName: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const t = messages(locals.locale).settings.account;
		const formData = await request.formData();
		const name = formData.get('name');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, { nameError: t.nameRequired });
		}

		try {
			await auth().api.updateUser({ headers: request.headers, body: { name: name.trim() } });
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { nameError: err.message ?? t.nameSaveFailedFallback });
			}
			throw err;
		}
		return { nameSaved: true };
	},
	changePassword: async ({ request, cookies, locals }) => {
		if (!locals.user) return fail(401);
		const t = messages(locals.locale).settings.account;
		const formData = await request.formData();
		const currentPassword = formData.get('currentPassword');
		const newPassword = formData.get('newPassword');
		if (
			typeof currentPassword !== 'string' ||
			currentPassword.length === 0 ||
			typeof newPassword !== 'string' ||
			newPassword.length === 0
		) {
			return fail(400, { passwordError: t.passwordRequired });
		}

		try {
			// Better Auth reissues the session cookie on a password change, so the headers it
			// hands back have to reach the browser or this tab is left holding the old token.
			const { headers } = await auth().api.changePassword({
				headers: request.headers,
				body: { currentPassword, newPassword },
				returnHeaders: true
			});
			forwardAuthCookies(headers, cookies);
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { passwordError: err.message ?? t.passwordSaveFailedFallback });
			}
			throw err;
		}
		return { passwordSaved: true };
	},
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
				auth().api.deleteUser({
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
	},
	/**
	 * Issue #158: taking, changing or giving up the handle behind `/u/<handle>`. A form
	 * action rather than a client call for the same reason `saveName` became one in #262, and
	 * it goes through `setUserHandle` (`@canonry/db`) rather than Better Auth's `updateUser`,
	 * because the reserved list, the format and the case-insensitive uniqueness all live with
	 * the column and there is no version of them Better Auth could enforce.
	 *
	 * `setUserHandle` answers rather than throws, so every refusal - reserved word, bad
	 * shape, somebody already has it - arrives here as a `reason` and leaves as one sentence
	 * from the catalogue. `handleError` is a total function over that union, so a seventh
	 * reason added to the query layer fails to compile here instead of rendering nothing.
	 */
	saveHandle: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const t = messages(locals.locale).settings.account;
		const formData = await request.formData();
		const handle = formData.get('handle');
		if (typeof handle !== 'string') return fail(400, { handleError: t.handleError('empty') });

		const result = await setUserHandle(db(), locals.user.id, handle);
		if (!result.ok) return fail(400, { handleError: t.handleError(result.reason) });
		return { handleSaved: result.handle };
	},
	removeHandle: async ({ locals }) => {
		if (!locals.user) return fail(401);
		await clearUserHandle(db(), locals.user.id);
		return { handleRemoved: true };
	}
};
