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
// #197, and moved here in the same wave: the shipped relation catalogue's per-locale
// display strings are language data, and `apps/web`'s i18n bundle is imported by ordinary
// components that ship to the browser. It lived in `packages/copilot` for one afternoon and
// that dragged the copilot's whole server graph (the AI SDK, model routing, env secrets)
// into the client bundle through the barrel, which broke hydration on every page. This
// package has no dependencies at all, which is exactly why it is the right home.
export {
	RELATION_TYPE_CATALOGUE,
	relationTypeMatchCandidates,
	localizedRelationLabel,
	preferredRelationTypeByKey,
	type RelationTypeCatalogueEntry,
	type RelationTypeIdentity
} from './relation-catalogue.js';
