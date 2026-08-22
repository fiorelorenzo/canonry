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
// #346: which words in a locale carry no meaning of their own. Language data by
// definition, so it lives here for the same reason the relation catalogue below does, and
// it is data rather than a search: the tokenizer that compares it against canon belongs to
// whoever is searching.
export { functionWords, LOCALES_WITH_FUNCTION_WORDS } from './function-words.js';
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
// #306, and moved here from `apps/web/src/lib/markdown-secrets.ts` in that issue: the one
// definition of what a `:::secret` / `:::gmnote` fence hides. It has to be readable both by
// a component that ships to the browser and by `@canonry/db`'s players query, which is the
// same argument the relation catalogue above makes, and a second fence parser next to the
// fact query is exactly the drift guardrail 6 cannot afford. See the module's own doc.
export {
	splitSecretBlocks,
	stripSecretsForPlayers,
	isPlayerVisibleSpan,
	type SecretBlockKind,
	type BodySegment,
	type SecretSegment,
	type SourceSegment
} from './secret-blocks.js';
// #545: the mention-syntax counterpart to the fence definition above, needed by
// `packages/copilot`'s Ask (its AI-off answer quotes canon directly, no component in
// between) as well as by `apps/web` components. See the module's own doc for why it
// moved here rather than staying `apps/web`-only.
export { stripMentionSyntax } from './mentions.js';
