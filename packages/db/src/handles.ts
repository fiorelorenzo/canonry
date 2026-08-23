/**
 * Issue #158: what a handle is allowed to be, in one place, because the answer is used by
 * three layers that must not be allowed to disagree.
 *
 * `schema/auth.ts` builds its two check constraints out of the constants below, so the
 * database itself refuses a malformed or reserved handle whatever writes it; `setUserHandle`
 * (`queries/profiles.ts`) validates with the same constants before it writes, so a rejection
 * is a message a person can act on rather than a 23514; and `apps/web`'s settings form shows
 * that message. One definition, three consumers, rather than a regex in a form and a slightly
 * different one in a migration.
 *
 * Because the list ships inside a check constraint, adding to it is a migration rather than a
 * patch, which is exactly what issue #158 asks for: `/u/new` cannot be claimable the day the
 * app wants `/u/new` as a sibling segment, and the way to be sure of that is that Postgres
 * says so, not that every writer remembered to ask.
 */

/**
 * Every segment the app might want as a sibling of `/u/<handle>`, plus the top-level
 * segments this product already owns (`u`, `w`, `p` is absent on purpose - it is not a
 * plausible handle collision but `dev`, `static` and `assets` are, because a proxy or a
 * build output could end up there). Stored lowercase and compared against `lower(handle)`,
 * so `Admin` is refused as surely as `admin`.
 *
 * The list is the one from issue #158's own third comment, unchanged: writing it down there
 * first and copying it here is what makes it reviewable rather than a thing a component
 * grew.
 */
export const RESERVED_HANDLES: readonly string[] = [
	'new',
	'settings',
	'me',
	'admin',
	'api',
	'login',
	'signup',
	'signin',
	'logout',
	'about',
	'help',
	'support',
	'privacy',
	'terms',
	'pricing',
	'docs',
	'blog',
	'u',
	'w',
	'dev',
	'static',
	'assets'
];

export const HANDLE_MIN_LENGTH = 2;
export const HANDLE_MAX_LENGTH = 30;

/**
 * Lowercase letters, digits and single hyphens between them: no leading or trailing hyphen,
 * no run of two. Written as a POSIX-compatible source string with no anchors and no
 * JavaScript-only syntax, because `schema/auth.ts` interpolates this exact string into a
 * Postgres `~` check and a pattern that only one of the two engines understands would make
 * the database and the form disagree about the same input.
 *
 * ASCII only, and that is a decision rather than an oversight: a handle is a URL segment
 * somebody types from a card or reads down a phone, and an accented or non-Latin handle
 * either travels as percent-encoding, which nobody can read, or invites two handles that
 * render identically. A display name is where a person's own alphabet belongs, and
 * `user.name` stays exactly that.
 */
export const HANDLE_PATTERN_SOURCE = '[a-z0-9]+(-[a-z0-9]+)*';

const HANDLE_PATTERN = new RegExp(`^${HANDLE_PATTERN_SOURCE}$`);

export type HandleRejection = 'empty' | 'too-short' | 'too-long' | 'format' | 'reserved';

export type HandleValidation =
	{ ok: true; handle: string } | { ok: false; reason: HandleRejection };

/**
 * Trims, then judges. Returns the handle **as the person typed it**, case included, which is
 * the storage half of this issue's case decision (see the column comment in
 * `schema/auth.ts`): a handle is displayed the way its owner wrote it and matched without
 * regard to case, so `Lorenzo` and `lorenzo` cannot both exist and whichever was taken first
 * keeps its capitals.
 *
 * The reserved check runs before the length checks on purpose. `u` and `w` are both on the
 * list and both shorter than the minimum, so testing length first told somebody asking for
 * `/u/w` that their handle was too short, which is true and is not the reason they cannot
 * have it. A word this product has taken is taken at any length.
 */
export function validateHandle(input: string): HandleValidation {
	const handle = input.trim();
	if (handle.length === 0) return { ok: false, reason: 'empty' };
	const lowered = handle.toLowerCase();
	if (RESERVED_HANDLES.includes(lowered)) return { ok: false, reason: 'reserved' };
	if (handle.length < HANDLE_MIN_LENGTH) return { ok: false, reason: 'too-short' };
	if (handle.length > HANDLE_MAX_LENGTH) return { ok: false, reason: 'too-long' };
	if (!HANDLE_PATTERN.test(lowered)) return { ok: false, reason: 'format' };
	return { ok: true, handle };
}
