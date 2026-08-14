<script lang="ts">
	/** C2 = A: the inbox. A quiet nav badge (Sidebar), never a modal, grouped by what
	 * triggered the run - propagation and import stay separate rows, never merged. */
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<svelte:head><title>Proposals &middot; {data.universe.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-6 py-8">
	<h1 class="mb-6 text-2xl font-semibold text-ink">Proposals</h1>

	{#if data.plans.length === 0 && data.importJobs.length === 0}
		<p class="text-sm text-muted">Nothing pending. Edit an entry to start a propagation run.</p>
	{/if}

	{#each data.plans as plan (plan.id)}
		<a
			href={resolve(`/u/${data.universe.slug}/proposals/${plan.id}`)}
			class="mb-2 flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3 hover:border-ai-line"
		>
			<div class="min-w-0">
				<p class="font-medium text-ink">
					{plan.triggerEntityName
						? `From: editing ${plan.triggerEntityName}`
						: `From: ${plan.trigger}`}
				</p>
				<p class="text-xs text-muted">
					{plan.total} entries &middot; {formatWhen(plan.createdAt)}
				</p>
			</div>
			<span class="flex-none rounded-full bg-ai-bg px-2 py-1 font-mono text-xs text-ai">
				{plan.pending} pending
			</span>
		</a>
	{/each}

	{#each data.importJobs as job (job.id)}
		<a
			href={resolve(`/u/${data.universe.slug}/import/${job.id}/review`)}
			class="mb-2 flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3 hover:border-ai-line"
		>
			<div class="min-w-0">
				<p class="font-medium text-ink">From: {job.playbook} import</p>
				<p class="text-xs text-muted">
					{job.total} proposals: {job.pending} pending &middot; {formatWhen(job.createdAt)}
				</p>
			</div>
			<span class="flex-none rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2">
				Open import review
			</span>
		</a>
	{/each}
</div>
