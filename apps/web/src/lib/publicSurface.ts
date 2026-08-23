/**
 * The one definition of "this page is read by somebody with no account", used by the two
 * places that have to agree about it.
 *
 * `AppShell.svelte` passes through instead of drawing its own chrome, and `hooks.server.ts`
 * negotiates the locale from `Accept-Language` alone instead of from the signed-in account's
 * preference. Both were written for `/p/**` (decision E7, issue #127) with the prefix spelled
 * out inline in each, and issue #158 adds a second such surface: a profile is a link handed to
 * a stranger exactly as a players' wiki is, so a signed-in GM opening their own profile has to
 * see what that stranger sees, both in chrome and in language.
 *
 * Two prefixes rather than a list of route ids, because a route id (`/u/[handle]`) and a URL
 * path (`/u/lorenzo`) both start with the same segment and the two callers hold one each.
 */
const PUBLIC_READER_SEGMENTS = ['p', 'u'] as const;

export function isPublicReaderPath(value: string): boolean {
	return PUBLIC_READER_SEGMENTS.some(
		(segment) => value === `/${segment}` || value.startsWith(`/${segment}/`)
	);
}
