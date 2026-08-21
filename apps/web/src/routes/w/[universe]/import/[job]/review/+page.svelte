<script lang="ts">
	/**
	 * #42, D4 = B, and round seventeen V2 = A (#498, #480): the import review screen is
	 * the same queue surface the inbox now renders inline - every pending candidate
	 * visible as its own card, settled ones collapsed to a line - with D4's type filter
	 * chip bar as its only addition. Import proposals arrive already diffed by
	 * job-runner.ts's `materializeDocumentProposals`, so unlike a propagation plan
	 * (proposals/[plan]) there is no C3 checklist phase here: straight to the queue.
	 *
	 * `ProposalQueue` reads its `groups` prop exactly once, at mount (its own doc comment
	 * says writes patch local state "instead of the default full-page invalidate" on
	 * purpose) - so a filter switch has to force a remount to show fresh state, via the
	 * `{#key}` block below. Switching filters first awaits a fresh load (`selectFilter`),
	 * so the newly-mounted queue always starts from real, current database state rather
	 * than whatever was true when this page first loaded.
	 */
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { renderOutcomeNote } from '$lib/import/outcome-note';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import ProposalQueue, {
		type ProposalGroupView
	} from '$lib/components/proposals/ProposalQueue.svelte';
	import TypeFilterChips from '$lib/components/proposals/TypeFilterChips.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).import.review);
	let entityTypeLabel = $derived(messages(data.locale).proposals.diffCard.entityTypeLabel);

	const RUNNING_STATUSES = new Set(['queued', 'running']);

	let selectedType = $state<string | null>(null);
	let switchingFilter = $state(false);

	let isRunning = $derived(RUNNING_STATUSES.has(data.job.status));
	let filteredCandidates = $derived(
		selectedType === null
			? data.candidates
			: data.candidates.filter((c) => data.filterTypeById[c.id] === selectedType)
	);
	let activeLabel = $derived(data.buckets.find((b) => b.type === selectedType)?.label ?? null);
	// Issue #498: `ProposalQueue` takes `groups` everywhere now - one implicit,
	// unheaded group here, since this route is already scoped to one job by its own URL.
	let groups = $derived<ProposalGroupView[]>([
		{ id: data.job.id, heading: '', meta: '', importJobId: null, candidates: filteredCandidates }
	]);

	let renderedOutcomeNote = $derived(renderOutcomeNote(data.locale, data.job.outcomeNote));
	let issueNote = $derived(
		data.job.status === 'stopped_at_ceiling'
			? t.statusNote.stoppedAtCeiling(renderedOutcomeNote)
			: data.job.status === 'cancelled'
				? t.statusNote.cancelled(renderedOutcomeNote)
				: data.job.status === 'failed'
					? t.statusNote.failed(renderedOutcomeNote)
					: null
	);

	// D4's cost, accepted rather than worked around by reaching into ProposalQueue's own
	// state: switching chips remounts the queue, so it has to start from a fresh load or
	// it would show outcomes as they were when this page first opened.
	async function selectFilter(type: string | null): Promise<void> {
		switchingFilter = true;
		await invalidateAll();
		selectedType = type;
		switchingFilter = false;
	}

	function refreshNow(): void {
		void invalidateAll();
	}

	// D2 = B: "live feed of proposals, so review starts before the import ends" - while
	// the job is still running, this page's own data (job status, proposal counts, the
	// candidate list a filter switch reads) is kept current without the GM reaching for
	// the browser's reload button.
	$effect(() => {
		if (!isRunning) return;
		const interval = setInterval(() => void invalidateAll(), 4000);
		return () => clearInterval(interval);
	});
</script>

<svelte:head><title>{t.headTitle(data.universe.name)}</title></svelte:head>

<PageHeader title={t.heading(data.job.playbook)} />
<PageBody width="working">
	<div class="px-6 py-8">
		<p class="mb-2 text-xs text-muted">
			<a class="hover:underline" href={resolve(`/w/${data.universe.slug}/proposals`)}
				>{t.breadcrumbProposals}</a
			>
			/ <span class="text-ink-2">{t.breadcrumbCurrent}</span>
		</p>

		{#if isRunning}
			<!-- Round eleven P2 (#344): a job still running is furniture, not a word a model
		     wrote, so it wears the theme's own panel and line rather than the copilot's
		     hue, and the refresh control wears the accent because that is what interactive
		     means here. -->
			<div
				class="mb-4 flex items-center justify-between gap-3 rounded-md border border-line bg-panel-2 px-4 py-3 text-sm text-ink"
			>
				<span>
					{t.stillImporting(data.job.proposalsEmitted)}
				</span>
				<Button
					type="button"
					variant="link"
					size="sm"
					class="h-auto p-0 text-accent"
					onclick={refreshNow}
				>
					{t.refresh}
				</Button>
			</div>
		{:else if issueNote}
			<p class="mb-4 rounded-md border border-line bg-panel-2 px-4 py-3 text-sm text-muted">
				{issueNote}
			</p>
		{/if}

		{#if data.missingFromSource.length > 0}
			<div class="mb-4 rounded-md border border-line bg-panel-2 px-4 py-3 text-sm text-ink">
				<p class="font-medium">{t.missing.heading(data.missingFromSource.length)}</p>
				<p class="mt-1 text-muted">{t.missing.explanation}</p>
				<ul class="mt-3 flex flex-col gap-1.5">
					{#each data.missingFromSource as item (item.id)}
						<li>
							<a
								href={resolve(`/w/${data.universe.slug}/e/${item.slug}`)}
								class="text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg"
							>
								{item.name}
							</a>
							<span
								class="ml-1 rounded-full bg-accent-bg px-1.5 py-0.5 font-mono text-[10px] text-accent-ink uppercase"
							>
								{entityTypeLabel(item.type)}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if data.candidates.length === 0}
			<EmptyState
				kind={isRunning ? 'derived' : 'settled'}
				message={isRunning ? t.emptyRunning : t.emptyDone}
				explanation={isRunning ? t.emptyRunningExplanation : undefined}
			/>
		{:else}
			<div class="mb-4">
				<TypeFilterChips buckets={data.buckets} selected={selectedType} onSelect={selectFilter} />
			</div>

			{#if switchingFilter}
				<p class="text-sm text-muted">{t.filtering}</p>
			{:else}
				{#key selectedType}
					<ProposalQueue
						{groups}
						universeSlug={data.universe.slug}
						filterType={activeLabel}
						locale={data.locale}
					/>
				{/key}
			{/if}
		{/if}
	</div>
</PageBody>
