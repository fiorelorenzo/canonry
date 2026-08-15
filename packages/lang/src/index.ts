// SPEC.md §17. Two ideas, kept apart on purpose: a locale belongs to a person and is what the
// interface and the copilot's speech use; a content language belongs to an entry and is what
// the copilot writes in when its output lands inside that entry.
export {
	LOCALES,
	DEFAULT_LOCALE,
	LOCALE_NAMES,
	isLocale,
	toLocale,
	parseAcceptLanguage,
	negotiateLocale,
	type Locale
} from './locale.js';
export { guessLanguage, detectLanguage, canonLanguageFor, type LanguageGuess } from './detect.js';
