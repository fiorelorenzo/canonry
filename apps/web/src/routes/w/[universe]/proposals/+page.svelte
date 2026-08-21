<script lang="ts">
	/** C2 = A: the inbox. A quiet nav badge (Sidebar), never a modal, grouped by what
	 * triggered the run - propagation and import stay separate rows, never merged. */
	import { resolve } from '$app/paths';
	import { dateFormat, messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).proposals);

	function formatWhen(value: string | Date): string {
		const date = typeof value === 'string' ? new Date(value) : value;
		return dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
</script>

<svelte:head><title>{t.title} &middot; {data.universe.name}</title></svelte:head>

<PageHeader title={t.title} />
<PageBody width="working">
	<div class="px-6 py-8">
		{#if data.plans.length === 0 && data.importJobs.length === 0}
			<EmptyState kind="settled" message={t.inbox.empty} />
		{:else}
			<ul class="flex flex-col divide-y divide-line border-y border-line">
				{#each data.plans as plan (plan.id)}
					<li>
						<a
							href={resolve(`/w/${data.universe.slug}/proposals/${plan.id}`)}
							class="flex items-center justify-between gap-3 px-1 py-3 transition-colors hover:bg-panel-2"
						>
							<div class="min-w-0">
								<p class="font-medium text-ink">
									{t.inbox.from(t.provenance(plan.trigger, plan.triggerEntityName))}
								</p>
								<p class="text-xs text-muted">
									{t.inbox.entriesLabel(plan.total)} &middot; {formatWhen(plan.createdAt)}
								</p>
							</div>
							<!-- Round eleven P2 (#344): a count of what is waiting is not AI text. It keeps
							     its presence through the accent's own tint, which is what says "there is
							     something for you here" everywhere else in the shell. -->
							<span
								class="flex-none rounded-full bg-accent-bg px-2 py-1 font-mono text-xs text-accent-ink"
							>
								{t.inbox.pendingLabel(plan.pending)}
							</span>
						</a>
					</li>
				{/each}

				{#each data.importJobs as job (job.id)}
					<li>
						<a
							href={resolve(`/w/${data.universe.slug}/import/${job.id}/review`)}
							class="flex items-center justify-between gap-3 px-1 py-3 transition-colors hover:bg-panel-2"
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
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</PageBody>
