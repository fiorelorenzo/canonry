/**
 * The one place a surface reaches `Intl` from (issue #120's own requirement: "no surface
 * reaches for `Intl` directly"). Plurals, dates and numbers all need a real BCP-47
 * *region* to pick a convention - `Intl.NumberFormat('it')` alone is under-specified in
 * some engines, and the region is also where "decimal comma" actually comes from, so it
 * is pinned here rather than left to whatever the runtime defaults to.
 *
 * This tag is deliberately a different idea from both `Locale` (an interface language,
 * `@canonry/lang`'s `LOCALES`) and `entity.language` (a content language, no region at
 * all - see `packages/lang/src/locale.ts`'s own doc comment on the distinction): it is
 * only ever used to format a number, a date or a plural category for a person, never
 * stored, never compared.
 */
import type { Locale } from '@canonry/lang';

const INTL_TAG: Record<Locale, string> = { en: 'en-US', it: 'it-IT' };

export function numberFormat(
	locale: Locale,
	options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
	return new Intl.NumberFormat(INTL_TAG[locale], options);
}

export function dateFormat(
	locale: Locale,
	options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat(INTL_TAG[locale], options);
}

export function pluralRules(locale: Locale, options?: Intl.PluralRulesOptions): Intl.PluralRules {
	return new Intl.PluralRules(INTL_TAG[locale], options);
}
