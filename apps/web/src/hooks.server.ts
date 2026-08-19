/**
 * Three things every request goes through, composed in one `handle`: the theme rewrite
 * (G1) that already lived here, locale negotiation (issue #120, SPEC.md §17), and Better
 * Auth's session resolution and request interception (issue #86).
 *
 * `svelteKitHandler` (from `better-auth/svelte-kit`) matches the request URL against
 * `/api/auth/*` and, when it matches, calls `auth().handler` directly instead of `resolve`
 * - that is the entire SvelteKit mount, no catch-all route file needed (see the doc
 * comment on `$lib/server/auth.ts`). For every other path it falls through to the
 * `resolve` passed in below, which is the same theme-rewriting resolve this file always
 * used, now also rewriting `<html lang>` the same way (a plain string swap on
 * `app.html`'s hardcoded `lang="en"`, exactly like the `data-theme-pref` swap already
 * did for the theme attribute) so a screen reader picks the right pronunciation and a
 * search engine reads the right language, for every route including the ones rendered
 * by other packages under this same SvelteKit app (e.g. routes/p/**, issue #127).
 *
 * `event.locals.session`/`user`/`locale` are populated before that branch, so a route
 * loader, a form action and the auth handler itself all see the same thing.
 *
 * Issue #115: `startCanonSaveJobWorker()` is called once here, at module load, guarded by
 * `building` because SvelteKit's postbuild route analysis imports every server module with
 * no environment behind it, and a worker starting against a database that is not there
 * would fail `vite build`/CI for no reason. Every replica's own worker has to start from
 * its own boot, not only from whichever replica happens to receive a save - reclaiming a
 * lease a *different* replica abandoned cannot depend on this one ever being asked to
 * schedule something itself. Nothing else in this module runs at import: `auth()` builds
 * its instance on first use (issue #307), so both the mail-sending path set below and the
 * handler mount reach for it inside `handle` rather than at module scope.
 *
 * Issue #277: the two Better Auth endpoints that send a mail while answering go through
 * `guardMailSendingRequest` instead of straight to `auth.handler`, because Better Auth
 * answers `{status: true, "check your email"}` even when the send threw. See
 * `$lib/server/mail/send-guard.ts`'s own doc comment for what that changes and for why
 * refusing before the address is looked up is what keeps the enumeration hedge intact.
 */
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { startCanonSaveJobWorker } from '$lib/server/jobs';
import { db } from '$lib/server/db';
import { LOCALE_COOKIE } from '$lib/i18n';
import { parseThemePreference, THEME_COOKIE, themeAttribute } from '$lib/theme';
import { negotiateLocale, type Locale } from '@canonry/lang';
import { eq } from '@canonry/db';
import { user as userTable } from '@canonry/db/schema';
import type { Cookies, Handle, RequestEvent } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { env } from '$env/dynamic/private';
import { isMailTransportConfigured } from '$lib/server/mail/transport';
import { guardMailSendingRequest, mailSendingAuthPaths } from '$lib/server/mail/send-guard';

if (!building) startCanonSaveJobWorker();

/** The slice of a `RequestEvent` locale negotiation actually needs - narrow on purpose,
 * so a test can build one of these without a real SvelteKit request. */
export interface LocaleRequestEvent {
	url: URL;
	cookies: Pick<Cookies, 'get'>;
	request: Pick<Request, 'headers'>;
	locals: { user: { id: string } | null };
}

/**
 * The negotiation order SPEC.md §17 fixes, resolved once per request: an explicit
 * account preference, then the `canonry_locale` cookie for a visitor with no account,
 * then `Accept-Language`, then English (`negotiateLocale` itself, from `@canonry/lang`,
 * owns that fallback chain - this function's only job is gathering the three inputs).
 *
 * The account preference is read with a direct, single-column query rather than off
 * `auth.api.getSession`'s own response: Better Auth only serialises fields it has been
 * told about via `additionalFields`, which `$lib/server/auth.ts` does not declare for
 * `locale` (confirmed against a live session response - the column exists in Postgres
 * but never reaches `getSession`'s JSON), so reading it through the session object would
 * silently and permanently negotiate as if nobody had ever chosen.
 *
 * Issue #127's exception lives here, not in the caller: the players' wiki is public,
 * shows no switcher of its own, and must never let a signed-in GM's own preference (or a
 * cookie set elsewhere on this origin) leak into a link they hand to their players - its
 * chrome follows the visitor's own browser, full stop.
 */
export async function resolveLocale(event: LocaleRequestEvent): Promise<Locale> {
	const acceptLanguage = event.request.headers.get('accept-language');

	if (event.url.pathname === '/p' || event.url.pathname.startsWith('/p/')) {
		return negotiateLocale({ acceptLanguage });
	}

	const cookie = event.cookies.get(LOCALE_COOKIE);
	let accountPreference: string | null = null;
	if (event.locals.user) {
		const rows = await db()
			.select({ locale: userTable.locale })
			.from(userTable)
			.where(eq(userTable.id, event.locals.user.id))
			.limit(1);
		accountPreference = rows[0]?.locale ?? null;
	}
	return negotiateLocale({ accountPreference, cookie, acceptLanguage });
}

/** Derived from the endpoint objects Better Auth actually mounted (`$lib/server/auth.ts`
 * configures exactly these two senders: `sendResetPassword` and
 * `sendDeleteAccountVerification`). A third sender means a third entry here, and
 * `send-guard.ts` derives the paths so a rename upstream cannot silently miss.
 *
 * Memoised on first use rather than resolved at module load, because reading `auth()`
 * builds the Better Auth instance and this module is one of the ones SvelteKit's postbuild
 * `analyse` step imports (issue #307). The set is the same for the life of the process
 * either way.
 *
 * `basePath` is read off the options rather than written out, the same way
 * `svelteKitHandler`'s own `isAuthPath` reads it, so a future override lands in one place
 * and not two. `auth.ts` sets none today, and the option is optional, so the presence check
 * is what keeps this honest rather than decoration. */
let mailSendingPathCache: Set<string> | undefined;

function mailSendingPaths(): Set<string> {
	if (!mailSendingPathCache) {
		const { api, options } = auth();
		mailSendingPathCache = mailSendingAuthPaths(
			typeof options.basePath === 'string' ? options.basePath : undefined,
			[api.requestPasswordReset, api.deleteUser]
		);
	}
	return mailSendingPathCache;
}

export const handle: Handle = async ({ event, resolve }) => {
	const session = building ? null : await auth().api.getSession({ headers: event.request.headers });
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;
	event.locals.locale = building ? 'en' : await resolveLocale(event);

	const rewrite = (innerEvent: RequestEvent) => {
		const preference = parseThemePreference(innerEvent.cookies.get(THEME_COOKIE));
		const attribute = themeAttribute(preference);
		const locale = event.locals.locale;

		return resolve(innerEvent, {
			transformPageChunk: ({ html }) => {
				const themed = attribute
					? html.replace('data-theme-pref', `data-theme="${attribute}"`)
					: html.replace(' data-theme-pref', '');
				return themed.replace('lang="en"', `lang="${locale}"`);
			}
		});
	};

	// `svelteKitHandler`'s own first statement is `if (building) return resolve(event)`, so
	// during a build it never looks at the instance it was handed. Taking that branch here
	// instead is what keeps `auth()` uncalled while the bundler is reading (issue #307).
	const serve = async () =>
		building
			? rewrite(event)
			: svelteKitHandler({ auth: auth(), event, building, resolve: rewrite });

	if (!building && mailSendingPaths().has(event.url.pathname)) {
		return guardMailSendingRequest({ configured: isMailTransportConfigured(env), serve });
	}
	return serve();
};
