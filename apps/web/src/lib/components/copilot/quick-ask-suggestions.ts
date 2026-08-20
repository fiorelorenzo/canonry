/**
 * Decision R6, round thirteen (#381): three deterministic suggestions for the empty
 * conversation, drawn from the route and the entity type and never from a model - "they
 * cost nothing, they arrive before the panel finishes opening, and they cannot be wrong in
 * the way a generated suggestion can." A pure function of what page the GM is standing on,
 * so it is testable without a component, a stream or a locale bundle: the caller passes
 * its own already-localized strings in `t`, built from `messages(locale).shell.quickAsk
 * .suggestions`.
 *
 * Three buckets, exactly the ones R6 names:
 * - An entry route (`page.data.entity` present) - about that entry.
 * - `/proposals`, list or one under review - about what is pending.
 * - Everything else, `/entries` included - about the world, the same fallback the panel's
 *   own context line already uses for "no entity on this page".
 *
 * `QuickAsk.svelte` hides these once `quickAskState.turns` is non-empty: "a suggestion is
 * for somebody who does not know what to type and not for somebody mid-thought."
 */

const PROPOSALS_ROUTE_PREFIX = '/w/[universe]/proposals';

export interface QuickAskSuggestionEntity {
	name: string;
	/** The six-value `entity_type` enum (`packages/db/src/schema/enums.ts`), read as a
	 * plain string so this module never has to import the db package for one union. */
	type: string;
}

export interface QuickAskSuggestionInput {
	/** SvelteKit's `page.route.id`, or `null` off any matched route. */
	routeId: string | null;
	/** The page's own entity, narrowed the same way the panel's context line narrows
	 * `page.data.entity` - present on an entry route, `null` everywhere else. */
	entity: QuickAskSuggestionEntity | null;
}

/** Already-localized templates, one bucket per case above. `entry.connects` is the one
 * that reads the entity type, the same "state one shape per entity type" pattern
 * `entityTypeLabel` uses elsewhere in the catalogue rather than six more top-level keys. */
export interface QuickAskSuggestionMessages {
	entry: {
		summary: (entityName: string) => string;
		connects: (entityType: string, entityName: string) => string;
		gaps: (entityName: string) => string;
	};
	world: {
		shape: string;
		recent: string;
		gaps: string;
	};
	proposals: {
		pending: string;
		oldest: string;
		conflicts: string;
	};
}

export function quickAskSuggestions(
	input: QuickAskSuggestionInput,
	t: QuickAskSuggestionMessages
): string[] {
	if (input.entity) {
		return [
			t.entry.summary(input.entity.name),
			t.entry.connects(input.entity.type, input.entity.name),
			t.entry.gaps(input.entity.name)
		];
	}
	if (input.routeId?.startsWith(PROPOSALS_ROUTE_PREFIX)) {
		return [t.proposals.pending, t.proposals.oldest, t.proposals.conflicts];
	}
	return [t.world.shape, t.world.recent, t.world.gaps];
}
