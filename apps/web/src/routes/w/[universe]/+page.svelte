<script lang="ts">
	/**
	 * `/w/[universe]`: the world home, O1 = C (#283). A masthead (the world's name, its
	 * homebrew/derived line, and the three headline figures as tabular numerals per G2) over
	 * the three sections the decision names: Continue, Waiting for you, Recent activity.
	 *
	 * What is deliberately not here:
	 *
	 * - **No list of entries.** That is the browser at `/w/[universe]/entries`, which the
	 *   sidebar's `Entries` item points at. This page's link into it is `browseEntries`; the
	 *   whole argument for O1 = C was that one page trying to be both read as neither.
	 * - **No cover band yet.** The decision draws one above the world's name, and a world has
	 *   no cover to read: O2 (#284) gave the column to `entity`, one cover per entry, which is
	 *   what the Continue cards use. Inventing a second way to pick an image here is exactly
	 *   what O1's own text rules out, so the band waits for a world-level answer.
	 * - **No review controls.** See `WaitingForYou.svelte`: pointers into the inbox only.
	 *
	 * `navCounts` and `shellQuota` come from the two layout loads that already compute them
	 * for the sidebar and its quota meter, so the masthead's figures cost this route nothing.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import ActivityFeed from '$lib/components/entries/ActivityFeed.svelte';
	import ContinueRow from '$lib/components/entries/ContinueRow.svelte';
	import WaitingForYou from '$lib/components/entries/WaitingForYou.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).universe.index);
	const homeT = $derived(t.home);
	const proposalsT = $derived(messages(data.locale).proposals);
	const relationTypeLabel = $derived(messages(data.locale).relationTypeLabel);

	const entriesHref = $derived(resolve(`/w/${data.current.slug}/entries`));

	// The included-credits line the shell's own meter reads, restated as spent-of-granted:
	// `includedRemaining` decrements as it is spent, so "used" is the difference.
	const quota = $derived(
		data.shellQuota
			? {
					used: Math.max(0, data.shellQuota.includedTotal - data.shellQuota.includedRemaining),
					total: data.shellQuota.includedTotal
				}
			: null
	);

	const waitingRows = $derived(data.waiting.plans.length + data.waiting.importJobs.length);
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
		<Button href={entriesHref} variant="secondary">{homeT.browseEntries}</Button>
	{/snippet}
</PageHeader>

<dl class="mt-5 flex flex-wrap gap-x-10 gap-y-4">
	<div class="flex flex-col gap-0.5">
		<dd class="text-xl font-semibold text-ink tabular-nums">{data.navCounts.entries}</dd>
		<dt class="text-[11px] font-medium tracking-wide text-muted uppercase">
			{homeT.entriesStat}
		</dt>
	</div>
	<div class="flex flex-col gap-0.5">
		<dd class="text-xl font-semibold text-ink tabular-nums">{data.navCounts.proposals}</dd>
		<dt class="text-[11px] font-medium tracking-wide text-muted uppercase">
			{homeT.waitingStat}
		</dt>
	</div>
	{#if quota}
		<div class="flex flex-col gap-0.5">
			<dd class="text-xl font-semibold text-ink tabular-nums">
				{homeT.quotaValue(quota.used, quota.total)}
			</dd>
			<dt class="text-[11px] font-medium tracking-wide text-muted uppercase">
				{homeT.quotaStat}
			</dt>
		</div>
	{/if}
</dl>

<section class="mt-8">
	<h2 class="mb-3 text-sm font-semibold text-ink">{homeT.continueHeading}</h2>
	{#if data.continueEntries.length === 0}
		<EmptyState kind="cold" message={t.emptyColdMessage}>
			{#snippet action()}
				<!-- Creation lives on the browser, with the dialog and the action behind it, so
				     a cold world is sent to the one place an entry is made rather than growing a
				     second create path here. -->
				<Button href={`${entriesHref}?new=entry`}>{t.newEntryAction}</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ContinueRow universeSlug={data.current.slug} entries={data.continueEntries} {t} />
	{/if}
</section>

<section class="mt-8">
	<h2 class="mb-3 text-sm font-semibold text-ink">{homeT.waitingHeading}</h2>
	{#if waitingRows === 0}
		<EmptyState kind="settled" message={homeT.waitingEmpty} />
	{:else}
		<WaitingForYou
			universeSlug={data.current.slug}
			plans={data.waiting.plans}
			importJobs={data.waiting.importJobs}
			totalPending={data.waiting.totalPending}
			t={homeT}
			{proposalsT}
		/>
	{/if}
</section>

<section class="mt-8">
	<h2 class="mb-3 text-sm font-semibold text-ink">{homeT.activityHeading}</h2>
	{#if data.activity.length === 0}
		<EmptyState kind="settled" message={homeT.activityEmpty} />
	{:else}
		<ActivityFeed
			universeSlug={data.current.slug}
			items={data.activity}
			t={homeT}
			relativeTimeT={t.relativeTime}
			{relationTypeLabel}
		/>
	{/if}
</section>
