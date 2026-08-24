<script lang="ts">
	/**
	 * The type chips, with their real counts. Same chip look as
	 * `proposals/TypeFilterChips.svelte`, but these are links, not buttons: filtering happens
	 * server side against Postgres, so a click is a normal navigation and a filtered view is
	 * bookmarkable and back-button safe.
	 *
	 * O1 = C (#283) moved this from the world home to the browser at `/w/<slug>/entries`, where
	 * it now composes with the sort, the direction and the search a table also carries -
	 * `browseQuery` is what keeps those in the URL rather than dropping them on every chip
	 * click. Changing a filter always returns to page 1, since page 4 of one filter is nowhere
	 * in another.
	 *
	 * The active chip is `aria-current="true"` and not `"page"` (#731), which is #724's rule
	 * applied rather than a second convention: `page` is "the current page within a set of
	 * pages" and the set a chip belongs to is a set of filters. The paginator below is the set
	 * of pages over this list; the chip row is the set of filters over it, and being adjacent
	 * to the one does not make the other's members pages. What made the old value observably
	 * false is the page reset above: on `/entries?type=character&page=2` the Character chip's
	 * href is `?type=character`, which is page 1 of the same filter, so it announced "current
	 * page" while pointing at a different page inside exactly the set `page` is defined over.
	 * A conditional (`page` when the href happens to equal the current URL, `true` otherwise)
	 * is cheap here, since the condition is just `params.page === 1`, and it was still the
	 * wrong answer: it would make one control say two different sentences as the reader pages
	 * through, encoding pagination state on a control whose whole job is the filter, which is
	 * constant across pages. "Current" is true on every page.
	 *
	 * Deliberately five types, not six: 'session' has no create path anywhere in the product
	 * yet, so it never earns a chip. It still shows up under "All" and through search, so it
	 * stays reachable.
	 */
	import { resolve } from '$app/paths';
	import type { EntityType } from '@canonry/db/schema';
	import type { Messages } from '$lib/i18n';
	import { browseQuery, BROWSABLE_TYPES, type BrowseParams } from './browse-params';

	let {
		universeSlug,
		counts,
		totalCount,
		params,
		t
	}: {
		universeSlug: string;
		counts: Partial<Record<EntityType, number>>;
		totalCount: number;
		params: BrowseParams;
		t: Messages['universe']['index']['filters'];
	} = $props();

	const base = $derived(resolve(`/w/${universeSlug}/entries`));
</script>

<div class="flex flex-wrap items-center gap-2" role="group" aria-label={t.all}>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is `base`, a
	     resolve() result, plus a query string, which the rule cannot see through. -->
	<a
		href={`${base}${browseQuery(params, { type: null, page: 1 })}`}
		class="rounded-full border px-3 py-1 font-mono text-label tabular-nums"
		class:border-ink={params.type === null}
		class:bg-ink={params.type === null}
		class:text-panel={params.type === null}
		class:border-line-2={params.type !== null}
		class:text-ink-2={params.type !== null}
		aria-current={params.type === null ? 'true' : undefined}
	>
		{t.all}
		{totalCount}
	</a>
	{#each BROWSABLE_TYPES as type (type)}
		<a
			href={`${base}${browseQuery(params, { type, page: 1 })}`}
			class="rounded-full border px-3 py-1 font-mono text-label tabular-nums"
			class:border-ink={params.type === type}
			class:bg-ink={params.type === type}
			class:text-panel={params.type === type}
			class:border-line-2={params.type !== type}
			class:text-ink-2={params.type !== type}
			aria-current={params.type === type ? 'true' : undefined}
		>
			{t.typeLabel(type)}
			{counts[type] ?? 0}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</div>
