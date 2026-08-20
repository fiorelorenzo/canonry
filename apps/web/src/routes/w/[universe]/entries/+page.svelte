<script lang="ts">
	/**
	 * `/w/[universe]/entries`: the browser, O1 = C (#283). The filter bar the artifact draws
	 * (type chips with their counts, then the search box), the dense table, and the pager the
	 * loader now has real pages behind.
	 *
	 * The link back to the world home is here rather than in the sidebar on purpose: A2 = A
	 * caps that nav at seven items, and O1's own text gives the `Entries` item to this route and
	 * the home to the world switcher, so the home is one click away from every page through the
	 * switcher and one click away from this one through the line below the title.
	 */
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import * as InputGroup from '$lib/components/ui/input-group';
	import SearchIcon from '@lucide/svelte/icons/search';
	import EntryTable from '$lib/components/entries/EntryTable.svelte';
	import NewEntryDialog from '$lib/components/entries/NewEntryDialog.svelte';
	import TypeFilterRow from '$lib/components/entries/TypeFilterRow.svelte';
	import {
		browseQuery,
		DEFAULT_SORT,
		defaultDirectionFor
	} from '$lib/components/entries/browse-params';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.index);
	const entriesT = $derived(t.entries);

	let newEntryOpen = $state(false);

	// `TypeFilterRow` and `EntryTable` compose their own `browseQuery` links against this
	// same base, so the clear link below reuses the identical "one variation on the
	// current view" contract rather than hand-building a query string.
	const base = $derived(resolve(`/w/${data.current.slug}/entries`));
	const clearSearchHref = $derived(`${base}${browseQuery(data.params, { query: '', page: 1 })}`);

	// Issue #149 (A3 = C): the palette's "New entry" action navigates here with `?new=entry`
	// rather than reaching into this page's local dialog state from outside it. `replaceState`
	// strips the param immediately so reopening the page (back button, reload) does not reopen
	// the dialog on its own. The home's cold empty state links here the same way.
	$effect(() => {
		if (page.url.searchParams.get('new') !== 'entry') return;
		const url = new URL(page.url);
		url.searchParams.delete('new');
		// Rewrites the current URL to drop a consumed query param, it navigates nowhere.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, {});
		newEntryOpen = true;
	});
</script>

<svelte:head>
	<title>{entriesT.headTitle(data.current.name)}</title>
</svelte:head>

<a
	href={resolve(`/w/${data.current.slug}`)}
	class="mb-2 inline-block text-xs font-medium text-muted hover:text-ink"
>
	&larr; {entriesT.backToHome(data.current.name)}
</a>

<PageHeader title={entriesT.title}>
	{#snippet actions()}
		<Button onclick={() => (newEntryOpen = true)}>{t.newEntryAction}</Button>
	{/snippet}
</PageHeader>

<NewEntryDialog
	bind:open={newEntryOpen}
	error={form && 'message' in form ? form.message : undefined}
	{t}
/>

<div class="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
	<TypeFilterRow
		universeSlug={data.current.slug}
		counts={data.counts}
		totalCount={data.totalCount}
		params={data.params}
		t={t.filters}
	/>

	<form method="GET" class="ml-auto flex items-center gap-2">
		<!-- The type, the sort and the direction ride along as hidden fields only when they
		     differ from the loader's own defaults - the same rule `browseQuery` applies to every
		     other link on this page, so a plain search keeps the URL at `?q=payroll` rather than
		     restating `sort=changed&dir=desc` on every query. The page never rides along: a
		     search is a new result set, and page 4 of the old one is nowhere in it. -->
		{#if data.params.type}
			<input type="hidden" name="type" value={data.params.type} />
		{/if}
		{#if data.params.sort !== DEFAULT_SORT}
			<input type="hidden" name="sort" value={data.params.sort} />
		{/if}
		{#if data.params.direction !== defaultDirectionFor(data.params.sort)}
			<input type="hidden" name="dir" value={data.params.direction} />
		{/if}
		<InputGroup.Root class="w-full sm:w-64">
			<InputGroup.Input
				type="search"
				name="q"
				placeholder={t.searchPlaceholder}
				aria-label={t.searchPlaceholder}
				value={data.params.query}
			/>
			<InputGroup.Addon align="inline-end">
				<InputGroup.Button type="submit" aria-label={t.searchSubmit} title={t.searchSubmit}>
					<SearchIcon aria-hidden="true" />
				</InputGroup.Button>
			</InputGroup.Addon>
		</InputGroup.Root>
		{#if data.params.query}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `clearSearchHref`
			     is a `resolve()` result plus `browseQuery`'s query string, which the rule cannot
			     see through. -->
			<a href={clearSearchHref} class="shrink-0 text-xs font-medium text-muted hover:text-ink">
				{t.searchClear}
			</a>
		{/if}
	</form>
</div>

{#if data.params.query}
	<p class="mt-3 text-sm text-muted">
		{t.searchResultCount(data.params.query, data.matchedCount)}
	</p>
{/if}

{#if data.rows.length === 0}
	<div class="mt-6">
		{#if data.totalCount === 0}
			<EmptyState kind="cold" message={t.emptyColdMessage}>
				{#snippet action()}
					<Button onclick={() => (newEntryOpen = true)}>{t.newEntryAction}</Button>
				{/snippet}
			</EmptyState>
		{:else if data.params.query}
			<EmptyState kind="settled" message={t.emptySearchMessage(data.params.query)} />
		{:else}
			<EmptyState kind="settled" message={t.emptyFilteredMessage} />
		{/if}
	</div>
{:else}
	<EntryTable
		universeSlug={data.current.slug}
		rows={data.rows}
		params={data.params}
		window={data.window}
		matchedCount={data.matchedCount}
		t={entriesT}
		filtersT={t.filters}
		relativeTimeT={t.relativeTime}
	/>
{/if}
