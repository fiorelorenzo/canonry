<script lang="ts">
	/** #51: the plan page - C3's checklist, then C4/C5/C6's queue once diffs exist. */
	import { resolve } from '$app/paths';
	import PlanChecklist from '$lib/components/proposals/PlanChecklist.svelte';
	import ProposalQueue from '$lib/components/proposals/ProposalQueue.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Plan &middot; {data.universe.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-6 py-8">
	<p class="mb-2 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/u/${data.universe.slug}/proposals`)}>Proposals</a>
		/ <span class="text-ink-2">Plan</span>
	</p>
	<h1 class="mb-1 text-2xl font-semibold text-ink">
		Plan &middot; from {data.triggerEntityName
			? `editing ${data.triggerEntityName}`
			: 'propagation'}
	</h1>
	<p class="mb-6 text-sm text-muted">{data.plan.summary}</p>

	{#if data.plan.status !== 'spent'}
		<PlanChecklist
			rows={data.checklistRows}
			estimatedCredits={data.plan.estimatedCredits}
			candidateCap={data.plan.candidateCap}
		/>
	{:else}
		<ProposalQueue candidates={data.diffCandidates} universeSlug={data.universe.slug} />
	{/if}
</div>
