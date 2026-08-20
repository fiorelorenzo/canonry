<script lang="ts">
	/**
	 * `/w/[universe]`: the world home, O1 = C (#283). A masthead over the three sections the
	 * decision names: Continue, Waiting for you, Recent activity.
	 *
	 * The masthead (#348) is the world's name, its homebrew/derived line, and one line about
	 * how the world has been moving, with twelve weekly bars beside it when there is a shape
	 * to draw. It used to be three figures instead: `navCounts.entries`,
	 * `navCounts.proposals` and the credits spent. All three were already on screen, the
	 * first two on the sidebar's Entries and Proposals rows and the third in the shell's
	 * quota meter (F2 = A), so the most valuable space on the page was a third copy of the
	 * furniture around it. `WorldPulse` says the one thing none of those surfaces do.
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
	 * - **No count of anything the sidebar counts.** That is the whole of #348, and a
	 *   figure put back here later should have an answer to why the sidebar's copy of it is
	 *   not enough.
	 * - **No entrance animation, and this is #367's own answer rather than an omission.**
	 *   Q6 gives motion to a thing arriving, a panel expanding and a state that changed
	 *   under somebody's click, and refuses text on load. Nothing on this page is any of
	 *   the first three: three sections and a masthead are simply what the page is, so
	 *   three sections easing in one after another would be the refused case wearing the
	 *   decision's clothes. What the motion pass did reach here is the Continue cards'
	 *   hover, which now crosses on the fade token instead of snapping.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import ActivityFeed from '$lib/components/entries/ActivityFeed.svelte';
	import ContinueRow from '$lib/components/entries/ContinueRow.svelte';
	import WaitingForYou from '$lib/components/entries/WaitingForYou.svelte';
	import WorldPulse from '$lib/components/entries/WorldPulse.svelte';
	import { worldPulse } from '$lib/components/entries/world-pulse';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).universe.index);
	const homeT = $derived(t.home);
	const proposalsT = $derived(messages(data.locale).proposals);
	const relationTypeLabel = $derived(messages(data.locale).relationTypeLabel);

	const entriesHref = $derived(resolve(`/w/${data.current.slug}/entries`));

	// The quiet state's date comes from the feed's newest item, which this page has already
	// loaded, so saying when a stalled world was last touched costs no second read.
	const pulse = $derived(
		worldPulse({
			entryCount: data.navCounts.entries,
			counts: data.pulseWeeks,
			lastChangeAt: data.activity[0]?.at ?? null
		})
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

<WorldPulse {pulse} locale={data.locale} t={homeT} />

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
