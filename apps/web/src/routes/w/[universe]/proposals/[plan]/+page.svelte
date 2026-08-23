<script lang="ts">
	/** #51: the plan page - C3's checklist, then C4/C5/C6's queue once diffs exist. */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Page } from '$lib/components/ui/page';
	import PlanChecklist from '$lib/components/proposals/PlanChecklist.svelte';
	import ProposalQueue from '$lib/components/proposals/ProposalQueue.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).proposals);
	// Issue #498: `ProposalQueue` now takes `groups` everywhere, including a route that
	// is already scoped to one plan by its own URL - an empty `heading` renders with no
	// group header at all, exactly as this queue always looked here.
	let diffPriceCredits = $derived(
		data.pricing.kind === 'perDiff' ? data.pricing.diffPriceCredits : 0
	);
</script>

<svelte:head><title>{t.plan.crumbCurrent} &middot; {data.universe.name}</title></svelte:head>

<Page
	width="working"
	title={t.plan.heading(t.provenance(data.plan.trigger, data.triggerEntityName))}
>
	<div class="px-4 py-6 md:px-6 md:py-8">
		<p class="mb-2 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/w/${data.universe.slug}/proposals`)}>{t.title}</a>
			/ <span class="text-ink-2">{t.plan.crumbCurrent}</span>
		</p>
		<p class="mb-6 text-sm text-muted">{data.plan.summary}</p>

		{#if data.plan.status !== 'spent'}
			<PlanChecklist
				rows={data.checklistRows}
				pricing={data.pricing}
				candidateCap={data.plan.candidateCap}
				locale={data.locale}
			/>
		{:else}
			<ProposalQueue
				groups={[
					{
						id: data.plan.id,
						heading: '',
						meta: '',
						importJobId: null,
						candidates: data.diffCandidates
					}
				]}
				universeSlug={data.universe.slug}
				{diffPriceCredits}
				locale={data.locale}
			/>
		{/if}
	</div>
</Page>
