<script lang="ts">
	/** #51: the plan page - C3's checklist, then C4/C5/C6's queue once diffs exist. */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import PlanChecklist from '$lib/components/proposals/PlanChecklist.svelte';
	import ProposalQueue from '$lib/components/proposals/ProposalQueue.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).proposals);
</script>

<svelte:head><title>{t.plan.crumbCurrent} &middot; {data.universe.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
	<p class="mb-2 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/u/${data.universe.slug}/proposals`)}>{t.title}</a>
		/ <span class="text-ink-2">{t.plan.crumbCurrent}</span>
	</p>
	<h1 class="mb-1 text-2xl font-semibold text-ink">
		{data.triggerEntityName
			? t.plan.headingFromEntity(data.triggerEntityName)
			: t.plan.headingFromPropagation}
	</h1>
	<p class="mb-6 text-sm text-muted">{data.plan.summary}</p>

	{#if data.plan.status !== 'spent'}
		<PlanChecklist
			rows={data.checklistRows}
			estimatedCredits={data.plan.estimatedCredits}
			candidateCap={data.plan.candidateCap}
			locale={data.locale}
		/>
	{:else}
		<ProposalQueue
			candidates={data.diffCandidates}
			universeSlug={data.universe.slug}
			locale={data.locale}
		/>
	{/if}
</div>
