/**
 * The one place that decides what a request answers when the mail it needed could not be
 * sent (#277).
 *
 * `./reset-password.ts` and `./delete-account.ts` already surface a failed send to a form
 * action through their own `AsyncLocalStorage` stores, and `/auth/forgot-password` and
 * `/settings/account` already act on it. What neither could reach is Better Auth's own
 * HTTP mount: `hooks.server.ts` hands every `/api/auth/*` request to `auth.handler`, and
 * `POST /api/auth/request-password-reset` answers
 *
 *     200 {"status":true,"message":"If this email exists in our system, check your email
 *          for the reset link"}
 *
 * whatever the send did, because Better Auth's `runInBackgroundOrAwait` awaits the sender,
 * logs whatever it throws through its own logger, and then answers the same either way
 * (verified in `node_modules/better-auth/dist/context/create-context.mjs`). That is the
 * right answer to "no account has this address" and a lie about a send that threw. Same
 * shape on `POST /api/auth/delete-user`, which answers `{success: true, message:
 * "Verification email sent"}`.
 *
 * Two rules, and the order between them is the whole point:
 *
 * 1. An unconfigured transport is refused *before* anything looks the address up. It is
 *    knowable from the environment alone, so the refusal cannot depend on whether the
 *    address has an account, and a stack with `RESEND_API_KEY` missing therefore answers
 *    every address identically instead of turning its own misconfiguration into an
 *    account-enumeration oracle. That ordering is why `isMailTransportConfigured` exists
 *    separately from the send itself.
 * 2. A send that was attempted and threw is answered with that same refusal, byte for
 *    byte. It says the mail could not be sent and nothing about the account.
 *
 * The enumeration hedge is untouched: a request for an address with no account still gets
 * Better Auth's own `{status: true, ...}` "if this email exists", because nothing was
 * attempted and nothing failed. What changes is only the case where a send really did
 * fail, which is a fact about this deployment rather than about the address.
 *
 * The residual difference worth naming: when the transport *is* configured and Resend
 * itself fails mid-request, an existing address gets the refusal and an unknown address
 * still gets the hedge, because no send is attempted for an address with no account and
 * none can be faked into failing. That signal costs an attacker a provider outage they
 * also have to observe, and the alternative is answering "check your inbox" over a mail
 * that never left, which is the bug this file exists to remove.
 */
import { deleteAccountSendOutcome } from './delete-account.js';
import { resetSendOutcome } from './reset-password.js';

/** Better Auth's own error body shape (`{message, code}`, `better-call`'s `APIError`), so
 * a client that already reads `error.code` off a failed auth call reads this one too. In
 * English only, unlike the form actions' localized copy: Better Auth's HTTP mount is
 * reached without this app's locale negotiation, and inventing a locale for it would be
 * guessing. */
export const MAIL_UNAVAILABLE_CODE = 'MAIL_TRANSPORT_UNAVAILABLE';
export const MAIL_UNAVAILABLE_MESSAGE =
	'The mail this request needs could not be sent right now. Nothing was sent, so try ' +
	'again in a moment.';
export const MAIL_UNAVAILABLE_STATUS = 503;

/** One body for every refusal, whatever failed and whoever asked: an existing address and
 * an unknown one get the same bytes, which is what keeps rule 1 above true. */
export function mailUnavailableResponse(): Response {
	return new Response(
		JSON.stringify({ code: MAIL_UNAVAILABLE_CODE, message: MAIL_UNAVAILABLE_MESSAGE }),
		{
			status: MAIL_UNAVAILABLE_STATUS,
			headers: { 'content-type': 'application/json' }
		}
	);
}

/** The absolute paths of the Better Auth endpoints that send a mail while answering,
 * derived from the endpoint objects themselves (`better-call` puts the route on the
 * handler as `.path`) rather than written out as strings here, so an upstream rename
 * cannot silently stop matching and quietly restore the 200. `basePath` is Better Auth's
 * own option, defaulting the same way its `svelteKitHandler` defaults it. */
export function mailSendingAuthPaths(
	basePath: string | undefined,
	endpoints: readonly { path: string }[]
): Set<string> {
	const base = (basePath ?? '/api/auth').replace(/\/$/, '');
	return new Set(endpoints.map((endpoint) => `${base}${endpoint.path}`));
}

export interface GuardMailSendingRequestInput {
	/** `isMailTransportConfigured(env)` at the call site, so this stays a pure decision. */
	configured: boolean;
	/** Whatever would have answered the request: Better Auth's handler, through
	 * `svelteKitHandler`. */
	serve: () => Promise<Response>;
}

/**
 * Wraps one mail-sending request: refuses up front when no transport is configured, and
 * otherwise replaces the answer with the same refusal when the send that request depended
 * on threw. Both outcome stores are installed because one wrapper covers both endpoints
 * and neither sender flips a store it was not given.
 */
export async function guardMailSendingRequest({
	configured,
	serve
}: GuardMailSendingRequestInput): Promise<Response> {
	if (!configured) return mailUnavailableResponse();

	const reset = { failed: false };
	const deletion = { failed: false };
	const response = await resetSendOutcome.run(reset, () =>
		deleteAccountSendOutcome.run(deletion, serve)
	);
	if (!reset.failed && !deletion.failed) return response;

	// Better Auth may have refreshed the session cookie while answering, and that has
	// nothing to do with the mail: dropping the response must not drop those.
	const refusal = mailUnavailableResponse();
	for (const cookie of response.headers.getSetCookie()) {
		refusal.headers.append('set-cookie', cookie);
	}
	return refusal;
}
