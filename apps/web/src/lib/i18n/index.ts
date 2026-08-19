/**
 * The one import surface for locale runtime, catalogue and formatters (issue #120).
 * Re-exports `@canonry/lang`'s negotiation/detection primitives so nothing under
 * `apps/web` reaches into that package directly and nothing here re-implements them.
 *
 * `messages(locale)` is a plain, synchronous, side-effect-free function - safe to call
 * from server load functions, form actions and `.svelte` components alike (this module
 * has no server-only dependency), and cheap enough to call fresh on every render rather
 * than threading the resolved catalogue object through page data. That matters
 * concretely: `PageData`/`LayoutData` cross the server/client boundary through
 * SvelteKit's `devalue` serializer, which cannot carry functions - and half of `Messages`
 * is functions (typed interpolation). Only the `Locale` string itself travels through
 * load data; every consumer calls `messages(data.locale)` (or `messages(locals.locale)`
 * on the server) itself, in a `$derived` if it needs to stay reactive to a locale change.
 */
export {
	DEFAULT_LOCALE,
	isLocale,
	LOCALE_NAMES,
	LOCALES,
	negotiateLocale,
	parseAcceptLanguage,
	toLocale,
	type Locale
} from '@canonry/lang';
export { dateFormat, numberFormat, pluralRules } from './intl.js';
export type { Messages, DetectedDetail } from './messages.js';

import { toLocale, type Locale } from '@canonry/lang';
import { en } from './en.js';
import { it } from './it.js';
import type { Messages } from './messages.js';

const CATALOGUE: Record<Locale, Messages> = { en, it };

export function messages(locale: Locale): Messages {
	return CATALOGUE[locale];
}

/** The cookie a visitor with no account carries an explicit choice in (SPEC.md §17's
 * second rung of `negotiateLocale`'s order) - mirrors `$lib/theme.ts`'s `THEME_COOKIE` in
 * shape and lifetime. Set by the compact switcher on the sign-in/sign-up pages; read by
 * `hooks.server.ts` on every request that is not the public players' wiki (issue #127:
 * that surface never reads an account preference or this cookie, only Accept-Language). */
export const LOCALE_COOKIE = 'canonry_locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** A submitted form's raw `locale` field, narrowed to a real `Locale` or `null` - shared
 * by every form action that lets someone choose one (`/settings/language`, and the
 * sign-in/sign-up pages' compact switcher), so "what counts as a valid submitted locale"
 * is answered in exactly one place. */
export function parseLocaleChoice(value: FormDataEntryValue | null): Locale | null {
	return typeof value === 'string' ? toLocale(value) : null;
}
