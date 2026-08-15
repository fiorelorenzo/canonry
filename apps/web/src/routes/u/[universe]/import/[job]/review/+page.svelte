<script lang="ts">
	/**
	 * #42, D4 = B: the import review screen. C6's queue, unchanged, with a type filter
	 * chip bar on top - D4's only addition to C6's own screen. Import proposals arrive
	 * already diffed by job-runner.ts's `materializeDocumentProposals`, so unlike a
	 * propagation plan (proposals/[plan]) there is no C3 checklist phase here: straight to
	 * the queue.
	 *
	 * `ProposalQueue` reads its `candidates` prop exactly once, at mount (it is its own
	 * self-contained, already-verified C6 implementation, not owned by this route, and its
	 * own doc comment says writes patch local state "instead of the default full-page
	 * invalidate" on purpose) - so a filter switch or a bulk reject has to force a remount
	 * to show fresh state, via the `{#key}` block below. Switching filters first awaits a
	 * fresh load (`selectFilter`), so the newly-mounted queue always starts from real,
	 * current database state rather than whatever was true when this page first loaded -
	 * the D4 mock's own promise that switching chips "never loses 40 accepted so far".
	 */
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import ProposalQueue from '$lib/components/proposals/ProposalQueue.svelte';
	import TypeFilterChips from '$lib/components/proposals/TypeFilterChips.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let t = $derived(messages(data.locale).import.review);

	const RUNNING_STATUSES = new Set(['queued', 'running']);

	let selectedType = $state<string | null>(null);
	let remountNonce = $state(0);
	let switchingFilter = $state(false);

	let isRunning = $derived(RUNNING_STATUSES.has(data.job.status));
	let filteredCandidates = $derived(
		selectedType === null
			? data.candidates
			: data.candidates.filter((c) => data.filterTypeById[c.id] === selectedType)
	);
	let activeLabel = $derived(data.buckets.find((b) => b.type === selectedType)?.label ?? null);

	let issueNote = $derived(
		data.job.status === 'stopped_at_ceiling'
			? t.statusNote.stoppedAtCeiling(data.job.outcomeNote || null)
			: data.job.status === 'cancelled'
				? t.statusNote.cancelled(data.job.outcomeNote || null)
				: data.job.status === 'failed'
					? t.statusNote.failed(data.job.outcomeNote || null)
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

	function onRejectedFiltered(): void {
		remountNonce += 1;
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

<div class="mx-auto max-w-3xl px-6 py-8">
	<p class="mb-2 text-xs text-muted">
		<a class="hover:underline" href={resolve(`/u/${data.universe.slug}/proposals`)}
			>{t.breadcrumbProposals}</a
		>
		/ <span class="text-ink-2">{t.breadcrumbCurrent}</span>
	</p>
	<h1 class="mb-4 text-2xl font-semibold text-ink">{t.heading(data.job.playbook)}</h1>

	{#if isRunning}
		<div
			class="mb-4 flex items-center justify-between gap-3 rounded-md border border-ai-line bg-ai-bg px-4 py-3 text-sm text-ink"
		>
			<span>
				{t.stillImporting(data.job.proposalsEmitted)}
			</span>
			<Button
				type="button"
				variant="link"
				size="sm"
				class="h-auto p-0 text-ai"
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

	{#if data.candidates.length === 0}
		<EmptyState
			kind={isRunning ? 'derived' : 'settled'}
			message={isRunning ? t.emptyRunning : t.emptyDone}
			explanation={isRunning ? t.emptyRunningExplanation : undefined}
		/>
	{:else}
		<div class="mb-4">
			<TypeFilterChips
				buckets={data.buckets}
				selected={selectedType}
				onSelect={selectFilter}
				{onRejectedFiltered}
				locale={data.locale}
			/>
		</div>

		{#if switchingFilter}
			<p class="text-sm text-muted">{t.filtering}</p>
		{:else}
			{#key `${selectedType}:${remountNonce}`}
				<ProposalQueue
					candidates={filteredCandidates}
					universeSlug={data.universe.slug}
					filterType={activeLabel}
					locale={data.locale}
				/>
			{/key}
		{/if}
	{/if}
</div>
