<script lang="ts">
	/**
	 * Issue #453 (U7): the settled-proposal page a revision's own history link points at
	 * (`HistoryPanel.svelte`, `entry.history.proposalLink`) - read-only, since guardrail 3
	 * asks for evidence here, not a second decision surface days after the first one
	 * already settled it. `ProposalDiffCard`'s four decision props are simply not passed:
	 * see that component's own comment for why they are optional now.
	 *
	 * `+page.server.ts` beside this file is the load half; `+server.ts` beside both is the
	 * write seam (`$lib/proposals/inline.ts`'s `fetchCandidate`/`decideProposal`) every
	 * in-place review surface already uses - unaffected by this file, since it always asks
	 * with `Accept: application/json` and only a plain navigation reaches this page.
	 *
	 * Issue #468: `data.candidate.awaitingDiff` skips `ProposalDiffCard` entirely rather
	 * than teaching it a fourth "nothing to show yet" branch - `patch = {}` used to fall
	 * straight through the card's diff branch as a full-body removal (`before` = the
	 * entity's live body, `after` = ''), which read as the copilot asking to delete two
	 * sentences of canon with no Accept, no Reject and no explanation. The diffed and
	 * settled cases below are untouched: same card, same props, same read-only page.
	 */
	import { resolve } from '$app/paths';
	import { messages, numberFormat } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import ProposalDiffCard from '$lib/components/proposals/ProposalDiffCard.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let t = $derived(messages(data.locale).proposals);
	let title = $derived(data.candidate.targetName ?? t.diffCard.newEntry);
	let costLabel = $derived(t.review.awaitingDiff.cost(data.diffPriceCredits ?? 0));
	// See AwaitingDiffCard: whole prices render whole, the way #489 settled it.
	let creditsFormat = $derived(numberFormat(data.locale, { maximumFractionDigits: 4 }));
</script>

<svelte:head>
	<title>{title} &middot; {data.universe.name}</title>
</svelte:head>

<!-- Issue #468: this page had no page-level heading at all - the only text naming what
     you were looking at was the 12px breadcrumb above, or (for the no-diff case) the
     struck-through body itself. -->
<PageHeader {title} />
<PageBody width="working">
	<div class="px-4 py-6 md:px-6 md:py-8">
		<p class="mb-2 text-xs text-muted">
			{#if data.candidate.targetSlug}
				<a
					class="hover:underline"
					href={resolve(`/w/${data.universe.slug}/e/${data.candidate.targetSlug}`)}
				>
					{data.candidate.targetName}
				</a>
			{:else}
				<a class="hover:underline" href={resolve(`/w/${data.universe.slug}/proposals`)}>
					{t.title}
				</a>
			{/if}
		</p>

		{#if data.candidate.awaitingDiff}
			<div class="card rounded-lg border border-line bg-panel p-4">
				<p class="mb-2 font-mono text-xs text-ink-2 uppercase">{t.review.awaitingDiff.kicker}</p>
				<h2 class="text-title text-ink">{t.review.awaitingDiff.body(title)}</h2>
				<p class="mt-1 max-w-measure text-body text-ink-2">{t.review.awaitingDiff.noDiffYet}</p>
				<p class="mt-3 max-w-measure text-sm text-ink-2">
					<span class="font-medium text-ink">{t.review.awaitingDiff.reasonLabel}</span>
					{data.candidate.rationale}
				</p>
				<p class="mt-3 text-sm text-ink-2">
					{costLabel.prefix}<b class="text-ink"
						>{creditsFormat.format(data.diffPriceCredits ?? 0)}</b
					>{costLabel.suffix}
				</p>
				<p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
					{#if data.candidate.planId}
						<InlineLink
							href={resolve(`/w/${data.universe.slug}/proposals/${data.candidate.planId}`)}
						>
							{t.review.awaitingDiff.planLink}
						</InlineLink>
					{/if}
					{#if data.candidate.targetSlug}
						<InlineLink href={resolve(`/w/${data.universe.slug}/e/${data.candidate.targetSlug}`)}>
							{t.review.awaitingDiff.backToEntry}
						</InlineLink>
					{/if}
				</p>
			</div>
		{:else}
			<ProposalDiffCard
				candidate={data.candidate}
				universeSlug={data.universe.slug}
				locale={data.locale}
				headingLevel={2}
			/>
		{/if}
	</div>
</PageBody>
