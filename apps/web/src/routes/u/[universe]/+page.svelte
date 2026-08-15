<script lang="ts">
	/**
	 * `/u/[universe]`: issue #145, decision I7 = C - the entry browser is the universe
	 * home. A type filter row with real counts, a name/alias search, and a "New entry"
	 * action, with the collapsible overview strip (`OverviewStrip.svelte`) pinned above
	 * both. No page chrome of its own beyond `PageHeader`: `Shell` (#138/#141) owns the
	 * frame this route renders into.
	 */
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import OverviewStrip from '$lib/components/entries/OverviewStrip.svelte';
	import TypeFilterRow from '$lib/components/entries/TypeFilterRow.svelte';
	import NewEntryDialog from '$lib/components/entries/NewEntryDialog.svelte';
	import { relativeTime } from '$lib/components/entries/relative-time';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.index);

	let newEntryOpen = $state(false);

	// Issue #149 (A3 = C): the palette's "New entry" action navigates here with
	// `?new=entry` rather than reaching into this page's own local dialog state from
	// outside it - `replaceState` strips the param immediately so reopening the page
	// (back button, reload) does not reopen the dialog on its own.
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
	<title>{data.current.name}: Canonry</title>
</svelte:head>

<PageHeader
	title={data.current.name}
	eyebrow={data.current.baseUniverseName ? t.derivedEyebrow : t.homebrewEyebrow}
	description={data.current.baseUniverseName
		? `${t.derivedNoticeBefore}${data.current.baseUniverseName}${t.derivedNoticeAfter}`
		: undefined}
>
	{#snippet actions()}
		<Button onclick={() => (newEntryOpen = true)}>{t.newEntryAction}</Button>
	{/snippet}
</PageHeader>

<NewEntryDialog
	bind:open={newEntryOpen}
	error={form && 'message' in form ? form.message : undefined}
	{t}
/>

<div class="mt-6">
	<OverviewStrip
		universeSlug={data.current.slug}
		initialCollapsed={data.stripCollapsed}
		whatChanged={data.whatChanged}
		pendingReview={data.pendingReview}
		quota={data.quota}
		currentWork={data.currentWork}
		{t}
	/>

	<TypeFilterRow
		universeSlug={data.current.slug}
		counts={data.counts}
		totalCount={data.totalCount}
		selected={data.selectedType}
		query={data.query}
		t={t.filters}
	/>

	<form method="GET" class="mt-4">
		{#if data.selectedType}
			<input type="hidden" name="type" value={data.selectedType} />
		{/if}
		<Input
			type="search"
			name="q"
			placeholder={t.searchPlaceholder}
			value={data.query}
			class="max-w-sm"
		/>
	</form>

	{#if data.entries.length === 0}
		<div class="mt-4">
			{#if data.totalCount === 0}
				<EmptyState kind="cold" message={t.emptyColdMessage}>
					{#snippet action()}
						<Button onclick={() => (newEntryOpen = true)}>{t.newEntryAction}</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<EmptyState kind="settled" message={t.emptyFilteredMessage} />
			{/if}
		</div>
	{:else}
		<ul class="mt-4 flex flex-col divide-y divide-line">
			{#each data.entries as entry (entry.id)}
				<li class="flex items-start justify-between gap-4 py-3">
					<div class="min-w-0">
						<a
							href={resolve(`/u/${data.current.slug}/e/${entry.slug}`)}
							class="text-base font-medium text-ink hover:text-accent"
						>
							{entry.name}
						</a>
						<Badge variant="secondary" class="ml-2 align-middle font-mono uppercase">
							{t.filters.typeLabel(entry.type)}
						</Badge>
						{#if entry.excerpt}
							<p class="mt-1 max-w-measure text-sm text-ink-2">{entry.excerpt}</p>
						{/if}
					</div>
					<span class="shrink-0 text-xs text-nowrap text-muted">
						{t.changedAt(relativeTime(entry.updatedAt, t.relativeTime))}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
