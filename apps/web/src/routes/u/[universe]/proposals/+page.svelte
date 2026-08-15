<script lang="ts">
	/** C2 = A: the inbox. A quiet nav badge (Sidebar), never a modal, grouped by what
	 * triggered the run - propagation and import stay separate rows, never merged. */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).proposals);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

<svelte:head><title>{t.title} &middot; {data.universe.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-6 py-8">
	<h1 class="mb-6 text-2xl font-semibold text-ink">{t.title}</h1>

	{#if data.plans.length === 0 && data.importJobs.length === 0}
		<p class="text-sm text-muted">{t.inbox.empty}</p>
	{/if}

	{#each data.plans as plan (plan.id)}
		<a
			href={resolve(`/u/${data.universe.slug}/proposals/${plan.id}`)}
			class="mb-2 flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3 hover:border-ai-line"
		>
			<div class="min-w-0">
				<p class="font-medium text-ink">
					{plan.triggerEntityName
						? t.inbox.fromEntity(plan.triggerEntityName)
						: t.inbox.fromTrigger(plan.trigger)}
				</p>
				<p class="text-xs text-muted">
					{t.inbox.entriesLabel(plan.total)} &middot; {formatWhen(plan.createdAt)}
				</p>
			</div>
			<span class="flex-none rounded-full bg-ai-bg px-2 py-1 font-mono text-xs text-ai">
				{t.inbox.pendingLabel(plan.pending)}
			</span>
		</a>
	{/each}

	{#each data.importJobs as job (job.id)}
		<a
			href={resolve(`/u/${data.universe.slug}/import/${job.id}/review`)}
			class="mb-2 flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3 hover:border-ai-line"
		>
			<div class="min-w-0">
				<p class="font-medium text-ink">{t.inbox.importFrom(job.playbook)}</p>
				<p class="text-xs text-muted">
					{t.inbox.importSummary(job.total, job.pending)} &middot; {formatWhen(job.createdAt)}
				</p>
			</div>
			<span class="flex-none rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2">
				{t.inbox.openImportReview}
			</span>
		</a>
	{/each}
</div>
