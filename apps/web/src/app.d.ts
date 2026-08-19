// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Auth } from '$lib/server/auth';
import type { Locale } from '@canonry/lang';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			// Populated once per request in hooks.server.ts from the session cookie
			// (issue #86). Both null when the request is unauthenticated - every server
			// load and action reads these instead of re-deriving a session itself.
			session: Auth['$Infer']['Session']['session'] | null;
			user: Auth['$Infer']['Session']['user'] | null;
			// The one resolved interface locale for this request (issue #120, SPEC.md
			// §17), negotiated once in hooks.server.ts (see that file's `resolveLocale`)
			// from the account preference, the `canonry_locale` cookie, then
			// Accept-Language - never re-derived per route. The players' wiki
			// (routes/p/**, issue #127) is the one exception: it negotiates from
			// Accept-Language alone, on purpose, since it has no switcher of its own and
			// must never leak the GM's own preference into a link they share with players.
			locale: Locale;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
