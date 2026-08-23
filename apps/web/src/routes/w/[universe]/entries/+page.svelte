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
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import * as InputGroup from '$lib/components/ui/input-group';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import XIcon from '@lucide/svelte/icons/x';
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
	// same base, so the search box below reuses the identical "one variation on the current
	// view" contract rather than hand-building a query string.
	const base = $derived(resolve(`/w/${data.current.slug}/entries`));

	// #456 (U12): #398 built this as a `<form method="GET">` for the no-JS case, and it still
	// is one - with the submit button gone, a lone text field with no submit button in the
	// form still submits implicitly on Enter, so a browser with no JS loses nothing. What
	// changes is JS behaviour layered on top: typing debounces into a `goto()` that updates
	// the same URL `browseQuery` already builds for every other control on this page, on the
	// same 120ms `setTimeout`/`clearTimeout` shape `CommandPalette.svelte` and
	// `InstantSearch.svelte` already debounce a keystroke with (there, into a fetch; here,
	// into the URL the loader itself reads). `replaceState: true` on every one of those
	// `goto()` calls is what keeps a burst of keystrokes from spamming history - the field
	// mutates the current entry in place rather than pushing a new one per letter, so one
	// press of the back button leaves the search entirely instead of rewinding it one
	// character at a time.
	let queryValue = $state(data.params.query);
	// The query the URL currently reflects, whether this field's own debounce put it there or
	// an outside navigation (back/forward, a type chip, a column header) did. The second
	// effect below only resyncs `queryValue` for the outside case, so a `goto()` this
	// component just issued never fights the keystroke that triggered it.
	let appliedQuery = data.params.query;
	let debounceHandle: ReturnType<typeof setTimeout> | undefined;

	function searchHref(query: string): string {
		return `${base}${browseQuery(data.params, { query, page: 1 })}`;
	}

	function applySearch(query: string) {
		appliedQuery = query;
		// `searchHref` is a `resolve()` result plus `browseQuery`'s query string, which the
		// rule cannot see through, same as every other `browseQuery` href on this page.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(searchHref(query), { replaceState: true, keepFocus: true, noScroll: true });
	}

	$effect(() => {
		const value = queryValue;
		if (value === appliedQuery) return;
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => applySearch(value), 120);
	});

	// Resyncs the field after a navigation this component did not itself debounce - the
	// back button, a type chip, a column header - so the box always shows what the URL says
	// rather than whatever this session last typed.
	$effect(() => {
		if (data.params.query === appliedQuery) return;
		clearTimeout(debounceHandle);
		appliedQuery = data.params.query;
		queryValue = data.params.query;
	});

	function onSearchSubmit(event: SubmitEvent) {
		// With JS, Enter goes through the same debounced, replacing `goto()` immediately
		// instead of racing the browser's own (pushing) form submission. Without JS this
		// handler is never wired up, and the plain GET submission underneath still runs.
		event.preventDefault();
		clearTimeout(debounceHandle);
		applySearch(queryValue);
	}

	const clearSearchHref = $derived(searchHref(''));

	function onClearSearch(event: MouseEvent) {
		// Same reasoning as `onSearchSubmit`: with JS this intercepts the anchor below for an
		// instant, in-place clear; without JS the plain `href` underneath still navigates.
		event.preventDefault();
		clearTimeout(debounceHandle);
		queryValue = '';
		applySearch('');
	}

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

<Page width="wide" title={entriesT.title}>
	{#snippet actions()}
		<Button onclick={() => (newEntryOpen = true)}>{t.newEntryAction}</Button>
	{/snippet}
	{#snippet filters()}
		<TypeFilterRow
			universeSlug={data.current.slug}
			counts={data.counts}
			totalCount={data.totalCount}
			params={data.params}
			t={t.filters}
		/>

		<form method="GET" class="ml-auto flex items-center gap-2" onsubmit={onSearchSubmit}>
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
				<!-- `type="text"`, not `search`: `type="search"` drew Chrome's own clear cross in a
				     style nothing else on the page uses (#456/U12). The one clear control below,
				     in the product's own shape, replaces it and the removed submit button both. -->
				<InputGroup.Input
					type="text"
					name="q"
					placeholder={t.searchPlaceholder}
					aria-label={t.searchPlaceholder}
					bind:value={queryValue}
				/>
				{#if queryValue}
					<InputGroup.Addon align="inline-end">
						<Tooltip.Provider delayDuration={400}>
							<Tooltip.Root>
								<Tooltip.Trigger onclick={onClearSearch}>
									{#snippet child({ props })}
										<!-- eslint-disable svelte/no-navigation-without-resolve -- `clearSearchHref`
										     is a `resolve()` result plus `browseQuery`'s query string, which the rule
										     cannot see through. A real `href` stays underneath (#398's own no-JS
										     reasoning): without JS this is a plain link back to the same view minus
										     `q`; with JS the trigger's `onclick` above intercepts it for an instant,
										     in-place clear instead of a full navigation. -->
										<Button
											{...props}
											href={clearSearchHref}
											variant="ghost"
											size="icon"
											class="size-6 shrink-0 rounded-[calc(var(--radius)-5px)] p-0"
											aria-label={t.searchClear}
										>
											<XIcon aria-hidden="true" class="size-3.5" />
										</Button>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>{t.searchClear}</Tooltip.Content>
							</Tooltip.Root>
						</Tooltip.Provider>
					</InputGroup.Addon>
				{/if}
			</InputGroup.Root>
		</form>
	{/snippet}

	<a
		href={resolve(`/w/${data.current.slug}`)}
		class="mb-2 inline-block text-label font-medium text-muted hover:text-ink"
	>
		&larr; {entriesT.backToHome(data.current.name)}
	</a>

	<NewEntryDialog
		bind:open={newEntryOpen}
		error={form && 'message' in form ? form.message : undefined}
		{t}
	/>

	{#if data.params.query}
		<p class="mt-3 text-body text-muted">
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
</Page>
