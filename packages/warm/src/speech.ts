/**
 * SPEC.md §17 rule one, this package's own single call site (issue #123): the label
 * `warmOnPrep` writes onto a `draft_entity` proposal's `rationale` when it declares a
 * candidate NPC for an expected place - "why this draft exists", addressed to the GM, so
 * it follows the interface locale like every other proposal rationale in the product,
 * never the canon's own language (that lives on `WarmCandidate.contentLanguage`,
 * language.ts).
 */
import type { Locale } from '@canonry/lang';

export const NPC_DRAFT_RATIONALE: Record<Locale, (slot: number, slots: number) => string> = {
	en: (slot, slots) => `Prep drafted a candidate NPC for this place (slot ${slot} of ${slots}).`,
	it: (slot, slots) =>
		`La preparazione ha abbozzato un PNG candidato per questo luogo (slot ${slot} di ${slots}).`
};
