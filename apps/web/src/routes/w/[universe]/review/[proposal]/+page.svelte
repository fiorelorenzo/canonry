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
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import ProposalDiffCard from '$lib/components/proposals/ProposalDiffCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let t = $derived(messages(data.locale).proposals);
</script>

<svelte:head>
	<title>{data.candidate.targetName ?? t.diffCard.newEntry} &middot; {data.universe.name}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
	<p class="mb-4 text-xs text-muted">
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
	<ProposalDiffCard
		candidate={data.candidate}
		universeSlug={data.universe.slug}
		locale={data.locale}
	/>
</div>
