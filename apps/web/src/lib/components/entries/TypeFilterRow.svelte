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
		class="rounded-full border px-3 py-1 font-mono text-xs tabular-nums"
		class:border-ink={params.type === null}
		class:bg-ink={params.type === null}
		class:text-panel={params.type === null}
		class:border-line-2={params.type !== null}
		class:text-ink-2={params.type !== null}
		aria-current={params.type === null ? 'page' : undefined}
	>
		{t.all}
		{totalCount}
	</a>
	{#each BROWSABLE_TYPES as type (type)}
		<a
			href={`${base}${browseQuery(params, { type, page: 1 })}`}
			class="rounded-full border px-3 py-1 font-mono text-xs tabular-nums"
			class:border-ink={params.type === type}
			class:bg-ink={params.type === type}
			class:text-panel={params.type === type}
			class:border-line-2={params.type !== type}
			class:text-ink-2={params.type !== type}
			aria-current={params.type === type ? 'page' : undefined}
		>
			{t.typeLabel(type)}
			{counts[type] ?? 0}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</div>
