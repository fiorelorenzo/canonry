/**
 * Issue #197: the shipped relation-type catalogue's per-locale display strings, in one
 * place both `packages/copilot` and `apps/web` read from.
 *
 * Lives here rather than in `apps/web/src/lib/i18n` because two things need every
 * locale's strings before a request ever reaches the app: `resolveRelationType`'s rungs
 * one and two (this package's `relation-types.ts`) have to match a proposed label against
 * the *whole* catalogue, not just the caller's active locale - an Italian corpus proposes
 * Italian words regardless of which locale happens to be reading the resulting review
 * queue - and `packages/import`'s job-runner calls that resolver directly, a package that
 * cannot import from `apps/web`. `apps/web/src/lib/i18n/{en,it}.ts` re-export the slice
 * they need for `Messages.relationTypeLabel` from here instead of each keeping its own
 * copy of the same ten-entry object literal, so there is still exactly one literal per
 * language for a translator to find, just owned by this package rather than duplicated
 * into two.
 *
 * `en.ts`/`it.ts` import this file through the package's `./relation-catalogue` subpath
 * export (`package.json`), never through the package root - the root barrel
 * (`index.ts`) also re-exports `complete.ts`/`audit.ts`/`ask.ts` and the rest, which pull
 * in the `ai` SDK, gateway wiring and server-only secrets. `en.ts`/`it.ts` ship to the
 * browser (ordinary `.svelte` components import `Messages`), so an import through the
 * root would drag that entire server graph into the client bundle - not a bundle-size
 * nitpick, it breaks hydration outright, since dev-mode ESM loads every module a barrel
 * re-exports regardless of which name a caller actually uses. This module itself only
 * imports `@canonry/lang`'s `Locale`/`LOCALES`, so it is safe as a standalone entry
 * point; nothing else in this package should gain a dependency that changes that.
 *
 * Not injected through `ResolveRelationTypeDeps` the way `embed` is, on purpose: `embed`
 * varies by environment (a live gateway model in production, a deterministic stub in
 * tests) and that is exactly what makes it worth a seam. This catalogue is the opposite -
 * fixed shipped content, identical in every environment, and it has to be the *full*
 * multi-locale map regardless of who is calling, so there is nothing a caller could
 * legitimately override it with. Threading it through `ResolveRelationTypeDeps` and every
 * caller between here and `packages/import`'s job-runner (which does not otherwise know
 * or care about locales) would be plumbing with no seam behind it.
 *
 * Keys match `relation_type.key` exactly (decision L1, #195) for the ten shipped rows. A
 * universe's own type has no entry here, same rule `Messages.relationTypeLabel`'s own doc
 * comment states - #198 is where a GM's own type gets a per-locale label of its own.
 */
import { LOCALES, type Locale } from '@canonry/lang';

export interface RelationTypeCatalogueEntry {
	label: string;
	inverseLabel: string;
}

export const RELATION_TYPE_CATALOGUE: Record<Locale, Record<string, RelationTypeCatalogueEntry>> = {
	en: {
		commands: { label: 'commands', inverseLabel: 'commanded by' },
		employs: { label: 'employs', inverseLabel: 'employed by' },
		located_in: { label: 'located in', inverseLabel: 'contains' },
		member_of: { label: 'member of', inverseLabel: 'has member' },
		ally_of: { label: 'ally of', inverseLabel: 'ally of' },
		parent_of: { label: 'parent of', inverseLabel: 'child of' },
		owns: { label: 'owns', inverseLabel: 'owned by' },
		appointed: { label: 'appointed', inverseLabel: 'appointed by' },
		part_of: { label: 'part of', inverseLabel: 'contains' },
		protects: { label: 'protects', inverseLabel: 'protected by' }
	},
	it: {
		commands: { label: 'comanda', inverseLabel: 'comandato da' },
		employs: { label: 'impiega', inverseLabel: 'impiegato da' },
		located_in: { label: 'si trova in', inverseLabel: 'contiene' },
		member_of: { label: 'membro di', inverseLabel: 'ha come membro' },
		ally_of: { label: 'alleato di', inverseLabel: 'alleato di' },
		parent_of: { label: 'genitore di', inverseLabel: 'figlio di' },
		owns: { label: 'possiede', inverseLabel: 'posseduto da' },
		appointed: { label: 'nomina', inverseLabel: 'nominato da' },
		part_of: { label: 'parte di', inverseLabel: 'contiene' },
		protects: { label: 'protegge', inverseLabel: 'protetto da' }
	}
};

/** The narrow shape this module needs off a relation type row - just enough to stay
 * decoupled from `@canonry/db`'s schema types, since a catalogue lookup has no other
 * reason to depend on drizzle's inferred row shape. */
export interface RelationTypeIdentity {
	key: string;
	label: string;
	inverseLabel: string;
	universeId: string | null;
}

/** Every label string `type` is known by, forward and inverse, across every shipped
 * locale - the expanded set both of `resolveRelationType`'s rungs match a proposed label
 * against (#197). The row's own stored `label`/`inverseLabel` (English, from the seed
 * migration) is always included first so a caller that only wants "the" label keeps
 * getting it as the first entry; a universe's own type (`universeId` not null) has no
 * catalogue entry, so its set is just that one pair, unchanged from before this issue.
 * Deduplicated so a locale whose string happens to equal the stored one (nothing does
 * today, but nothing prevents it) does not produce two identical rung-1 candidates. */
export function relationTypeMatchCandidates(
	type: RelationTypeIdentity
): Array<{ label: string; direction: 'forward' | 'inverse' }> {
	const seen = new Set<string>();
	const out: Array<{ label: string; direction: 'forward' | 'inverse' }> = [];
	const add = (label: string, direction: 'forward' | 'inverse'): void => {
		const dedupeKey = `${direction}:${label}`;
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		out.push({ label, direction });
	};
	add(type.label, 'forward');
	add(type.inverseLabel, 'inverse');
	if (type.universeId === null) {
		for (const locale of LOCALES) {
			const entry = RELATION_TYPE_CATALOGUE[locale][type.key];
			if (!entry) continue;
			add(entry.label, 'forward');
			add(entry.inverseLabel, 'inverse');
		}
	}
	return out;
}

/** `type`'s display label in `locale` - the catalogue's translation for a shipped type,
 * falling back to the row's own stored label exactly like `Messages.relationTypeLabel`
 * does for an unrecognised key, or the row's stored label outright for a universe's own
 * type (SPEC.md §17 rule 3: canon stays in the language it was authored in, and guardrail
 * 1 forbids a model silently rewriting a GM's own words). Used for prompt text
 * (`complete.ts`, `diffs.ts`) - never for matching, which is `relationTypeMatchCandidates`'s
 * job instead. */
export function localizedRelationLabel(type: RelationTypeIdentity, locale: Locale): string {
	if (type.universeId !== null) return type.label;
	return RELATION_TYPE_CATALOGUE[locale][type.key]?.label ?? type.label;
}

/** Picks one row per `key` out of `types` - a universe's own type always wins over the
 * shipped catalogue's row on a tie, the same preference `relation-types.ts`'s own
 * `preferUniverseOwned` applies during matching. Needed because `relationTypesForUniverse`
 * can legitimately return two rows sharing a key: a GM is allowed to reuse a shipped
 * label for their own type (`relation.test.ts`'s "allows a universe-scoped relation type
 * to reuse a label from the shipped catalogue"), and the trigger that derives a universe
 * row's key from its label (migration 0032) then derives the same key text the shipped
 * row already has. `complete.ts`/`diffs.ts` use this to build the `key -> row` lookup
 * `localizedRelationLabel` reads from, where "the row for this key" has to mean one row,
 * not both. */
export function preferredRelationTypeByKey<T extends RelationTypeIdentity>(
	types: T[]
): Map<string, T> {
	const byKey = new Map<string, T>();
	for (const type of types) {
		const existing = byKey.get(type.key);
		if (!existing || (existing.universeId === null && type.universeId !== null)) {
			byKey.set(type.key, type);
		}
	}
	return byKey;
}
