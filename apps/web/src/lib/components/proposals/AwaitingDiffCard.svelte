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
	import { messages, type Locale } from '$lib/i18n';

	let {
		candidate,
		universeSlug,
		diffPriceCredits,
		locale
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
	} = $props();

	let t = $derived(messages(locale).proposals);
	let title = $derived(candidate.targetName ?? t.diffCard.newEntry);
	let costLabel = $derived(t.review.awaitingDiff.cost(diffPriceCredits));
</script>

<div class="border-t border-line pt-4" data-proposal-id={candidate.id}>
	<p class="mb-2 font-mono text-label text-ink-2 uppercase">{t.review.awaitingDiff.kicker}</p>
	<p class="max-w-measure text-body text-ink-2">{t.review.awaitingDiff.body(title)}</p>
	<p class="mt-3 max-w-measure text-body text-ink-2">
		<span class="font-medium text-ink">{t.review.awaitingDiff.reasonLabel}</span>
		{candidate.rationale}
	</p>
	<p class="mt-3 text-body text-ink-2">
		{costLabel.prefix}<b class="text-ink">{diffPriceCredits.toFixed(2)}</b>{costLabel.suffix}
	</p>
	<p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-body">
		{#if candidate.planId}
			<a
				class="text-accent hover:underline"
				href={resolve(`/w/${universeSlug}/proposals/${candidate.planId}`)}
			>
				{t.review.awaitingDiff.planLink}
			</a>
		{/if}
		{#if candidate.targetSlug}
			<a
				class="text-accent hover:underline"
				href={resolve(`/w/${universeSlug}/e/${candidate.targetSlug}`)}
			>
				{t.review.awaitingDiff.backToEntry}
			</a>
		{/if}
	</p>
</div>
