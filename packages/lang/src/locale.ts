// SPEC.md §17. The one place the set of interface languages is written down, so nothing else
// has to hardcode 'en' | 'it' and nothing drifts when a third locale arrives.
//
// Two distinct ideas live here and must not be confused, because confusing them is the
// mistake §17 is written to prevent:
//
//   * a **locale** is the language the interface and the copilot's speech use. It belongs to
//     a person, it is a preference on their account, and it is what an Ask answer, a
//     propagation plan's reason and every button label are written in.
//   * a **content language** is the language a piece of canon is written in. It belongs to an
//     entry, not to a person, and it is what the copilot writes in when it drafts text that
//     will land inside that entry.
//
// A locale is always one of ours. A content language is whatever the GM wrote, so it is a
// plain BCP-47 primary subtag and may be null when nobody knows.

/** Interface languages we ship. Ordered: the first is the fallback. */
export const LOCALES = ['en', 'it'] as const;

export type Locale = (typeof LOCALES)[number];

/** Used when nothing else is known: no account preference, no cookie, no usable header. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Endonyms, because a language picker that says "Italian" to somebody who only reads
 * Italian has failed at the one job it has. */
export const LOCALE_NAMES: Record<Locale, string> = {
	en: 'English',
	it: 'Italiano'
};

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Narrows a stored preference to a locale we can actually serve.
 *
 * Deliberately tolerant: the column is plain text, an old row may hold a full tag like
 * `it-CH`, and a value we dropped support for must degrade to null rather than throw on a
 * page load. Returning null means "nobody has chosen", which is the state that lets the
 * request's own header decide.
 */
export function toLocale(value: string | null | undefined): Locale | null {
	if (!value) return null;
	const primary = value.trim().toLowerCase().split(/[-_]/)[0];
	return isLocale(primary) ? primary : null;
}

interface AcceptLanguageEntry {
	tag: string;
	quality: number;
}

/** Parses an `Accept-Language` header into tags ordered by the client's own preference.
 * Malformed input yields an empty list rather than an exception: this runs on every request,
 * and a hostile header is not a 500. */
export function parseAcceptLanguage(header: string | null | undefined): AcceptLanguageEntry[] {
	if (!header) return [];
	const entries: AcceptLanguageEntry[] = [];
	for (const part of header.split(',')) {
		const [rawTag, ...params] = part.trim().split(';');
		const tag = rawTag?.trim().toLowerCase();
		if (!tag) continue;
		let quality = 1;
		for (const param of params) {
			const [key, value] = param.split('=').map((s) => s.trim());
			if (key === 'q') {
				const parsed = Number(value);
				quality = Number.isFinite(parsed) ? parsed : 0;
			}
		}
		if (quality > 0) entries.push({ tag, quality });
	}
	return entries.sort((a, b) => b.quality - a.quality);
}

/**
 * The negotiation order §17 fixes: an explicit choice, then a cookie for a visitor with no
 * account, then the browser's header, then English.
 *
 * An explicit choice wins over the header permanently and on purpose. A GM who picked English
 * on an Italian laptop meant it, and re-deciding that on every request from the header is the
 * behaviour that makes language switchers feel broken.
 */
export function negotiateLocale(input: {
	accountPreference?: string | null;
	cookie?: string | null;
	acceptLanguage?: string | null;
}): Locale {
	const chosen = toLocale(input.accountPreference) ?? toLocale(input.cookie);
	if (chosen) return chosen;
	for (const { tag } of parseAcceptLanguage(input.acceptLanguage)) {
		if (tag === '*') break;
		const candidate = toLocale(tag);
		if (candidate) return candidate;
	}
	return DEFAULT_LOCALE;
}
