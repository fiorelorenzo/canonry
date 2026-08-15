/**
 * SPEC.md §17 rule three (issue #124), scoped to this package's one call site: the
 * content language a `npc_draft` generator must draft `DraftEntityPayload.body` in.
 *
 * There is no "triggering entry" distinct from the subject for a warm candidate the way
 * propagation has an edited-vs-target split (SPEC.md §5.1) - a declared-prep NPC draft is
 * about the *place* it is anchored to, and nothing else. So the chain is `@canonry/lang`'s
 * `canonLanguageFor` with only `target*` supplied: the place's own recorded language, then
 * its own body, then English. Never the caller's interface locale (`WarmCandidate.locale`)
 * - reaching for that field here would be exactly the vandalism rule three exists to
 * prevent, which is why this takes the subject's fields as their own required argument
 * rather than a `WarmCandidate` a caller could pass by habit.
 */
import { canonLanguageFor, type Locale } from '@canonry/lang';

export function contentLanguageForSubject(subject: {
	language?: string | null;
	body?: string | null;
}): Locale {
	return canonLanguageFor({
		targetLanguage: subject.language ?? null,
		targetBody: subject.body ?? null
	});
}
