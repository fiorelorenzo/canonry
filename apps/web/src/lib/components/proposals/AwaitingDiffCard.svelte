<script lang="ts">
	/**
	 * Issue #498 (V2 = A), reusing #468's `awaitingDiff` rather than deriving the "no
	 * diff yet" state a second way: a plan candidate whose diff has not been generated
	 * has nothing for `ProposalDiffCard` to show - its `diff` is `EMPTY_PROSE_DIFF` or
	 * (worse, for `update`) a full-body removal - so `ProposalQueue` renders this instead,
	 * wherever a candidate's `awaitingDiff` is true. Same words #468 already wrote for the
	 * single-proposal deep link (`review/[proposal]/+page.svelte`), framed as one more row
	 * in the queue rather than its own page: says so, offers the price, links to the plan
	 * where C3's checklist (drop before paying, then generate) is still the only place
	 * that spends on it. No Accept or Reject here - there is nothing yet to decide.
	 */
	import { resolve } from '$app/paths';
	import { messages, numberFormat, type Locale } from '$lib/i18n';
	import { InlineLink } from '$lib/components/ui/link';

	let {
		candidate,
		universeSlug,
		diffPriceCredits,
		locale,
		headingLevel
	}: {
		candidate: {
			id: string;
			planId: string | null;
			targetName: string | null;
			targetSlug: string | null;
			rationale: string;
		};
		universeSlug: string;
		diffPriceCredits: number;
		locale: Locale;
		/** Issue #526: same caller-supplied level as `ProposalDiffCard`, which this card
		 * stands in for whenever a candidate's diff has not been generated yet - see that
		 * component's own doc comment. */
		headingLevel: 2 | 3;
	} = $props();

	let t = $derived(messages(locale).proposals);
	let title = $derived(candidate.targetName ?? t.diffCard.newEntry);
	let costLabel = $derived(t.review.awaitingDiff.cost(diffPriceCredits));
	// #489 took `toFixed(2)` off the plan page because two decimal places imply a
	// precision credits do not have, and this card reintroduced it: `propagate.diff` is
	// priced at 1, so "1.00 credit" reads as a rounded number rather than a whole one.
	// Same formatter, same four-digit ceiling, so a fractional price still shows.
	let creditsFormat = $derived(numberFormat(locale, { maximumFractionDigits: 4 }));
</script>

<div class="border-t border-line pt-4" data-proposal-id={candidate.id}>
	<p class="mb-2 font-mono text-label text-ink-2 uppercase">{t.review.awaitingDiff.kicker}</p>
	<svelte:element this={`h${headingLevel}`} class="text-title text-ink">
		{t.review.awaitingDiff.body(title)}
	</svelte:element>
	<p class="mt-1 max-w-measure text-body text-ink-2">{t.review.awaitingDiff.noDiffYet}</p>
	<p class="mt-3 max-w-measure text-body text-ink-2">
		<span class="font-medium text-ink">{t.review.awaitingDiff.reasonLabel}</span>
		{candidate.rationale}
	</p>
	<p class="mt-3 text-body text-ink-2">
		{costLabel.prefix}<b class="text-ink">{creditsFormat.format(diffPriceCredits)}</b
		>{costLabel.suffix}
	</p>
	<p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-body">
		{#if candidate.planId}
			<InlineLink href={resolve(`/w/${universeSlug}/proposals/${candidate.planId}`)}>
				{t.review.awaitingDiff.planLink}
			</InlineLink>
		{/if}
		{#if candidate.targetSlug}
			<InlineLink href={resolve(`/w/${universeSlug}/e/${candidate.targetSlug}`)}>
				{t.review.awaitingDiff.backToEntry}
			</InlineLink>
		{/if}
	</p>
</div>
