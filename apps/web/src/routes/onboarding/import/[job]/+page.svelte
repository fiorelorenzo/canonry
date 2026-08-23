<script lang="ts">
	/**
	 * D2 = B's live feed once the run is admitted, and D7's own "First accept" screen: an
	 * accept here (LiveProposalFeed's inline button) is the genuine, clicked accept
	 * guardrail 1 requires - never a pre-marked "accepted" badge. Polls
	 * /onboarding/import/[job]/status rather than SSE: the job runs server-side
	 * independent of this tab (issue #26), so a dropped connection just re-reads whatever
	 * import_job and proposal already hold on the next tick.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { renderOutcomeNote } from '$lib/import/outcome-note';
	import LiveProposalFeed from '$lib/components/onboarding/LiveProposalFeed.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Page } from '$lib/components/ui/page';
	import type { ProposalSummary } from '$lib/components/onboarding/proposalView';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let t = $derived(messages(data.locale).import);

	type ImportJobStatus =
		'queued' | 'running' | 'finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed';

	interface JobView {
		id: string;
		status: ImportJobStatus;
		documentCount: number;
		proposalsEmitted: number;
		outcomeNote: string;
		createdAt: string;
		startedAt: string | null;
		finishedAt: string | null;
	}

	// svelte-ignore state_referenced_locally
	let job = $state<JobView>({
		id: data.job.id,
		status: data.job.status,
		documentCount: data.job.documentCount,
		proposalsEmitted: data.job.proposalsEmitted,
		outcomeNote: data.job.outcomeNote,
		createdAt: data.job.createdAt.toISOString(),
		startedAt: data.job.startedAt ? data.job.startedAt.toISOString() : null,
		finishedAt: data.job.finishedAt ? data.job.finishedAt.toISOString() : null
	});
	// svelte-ignore state_referenced_locally
	let proposals = $state<ProposalSummary[]>(
		data.proposals.map((p) => ({
			id: p.id,
			kind: p.kind,
			patch: p.patch,
			rationale: p.rationale,
			outcome: p.outcome,
			decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
			createdAt: p.createdAt.toISOString()
		}))
	);

	const TERMINAL_STATUSES = new Set<ImportJobStatus>([
		'finished',
		'stopped_at_ceiling',
		'cancelled',
		'failed'
	]);

	$effect(() => {
		let stopped = false;
		const interval = setInterval(async () => {
			if (stopped) return;
			if (TERMINAL_STATUSES.has(job.status)) {
				clearInterval(interval);
				return;
			}
			const res = await fetch(`/onboarding/import/${data.job.id}/status`);
			if (!res.ok || stopped) return;
			const body = (await res.json()) as { job: JobView; proposals: ProposalSummary[] };
			job = body.job;
			proposals = body.proposals;
		}, 1000);
		return () => {
			stopped = true;
			clearInterval(interval);
		};
	});

	const acceptedId = $derived(page.url.searchParams.get('accepted'));
	const acceptedProposal = $derived(proposals.find((p) => p.id === acceptedId) ?? null);
	const elapsedToAcceptSeconds = $derived(
		acceptedProposal?.decidedAt
			? Math.round(
					(new Date(acceptedProposal.decidedAt).getTime() - new Date(job.createdAt).getTime()) /
						1000
				)
			: null
	);

	const pendingCount = $derived(proposals.filter((p) => p.outcome === 'pending').length);
	const isTerminal = $derived(TERMINAL_STATUSES.has(job.status));
	const renderedOutcomeNote = $derived(renderOutcomeNote(data.locale, job.outcomeNote));

	const terminalHeading = $derived(
		job.status === 'finished'
			? t.job.headingTerminal.finished
			: job.status === 'stopped_at_ceiling'
				? t.job.headingTerminal.stoppedAtCeiling
				: job.status === 'cancelled'
					? t.job.headingTerminal.cancelled
					: job.status === 'failed'
						? t.job.headingTerminal.failed
						: null
	);
</script>

<svelte:head>
	<title>{t.job.headTitle(data.universe.name)}</title>
</svelte:head>

<Page
	width="working"
	eyebrow={data.universe.name}
	title={acceptedProposal && elapsedToAcceptSeconds !== null
		? t.job.firstAcceptHeading
		: (terminalHeading ?? t.job.headingRunning)}
>
	<div class="flex flex-col gap-6 px-8 py-16">
		{#if form && 'error' in form && form.error}
			<p class="rounded-md bg-danger-bg px-3 py-2 text-body text-danger">{form.error}</p>
		{/if}

		{#if acceptedProposal && elapsedToAcceptSeconds !== null}
			<div class="rounded-lg border border-accent bg-accent-bg p-5">
				<p class="text-body text-ink">
					{t.job.firstAcceptMessage(elapsedToAcceptSeconds)}
				</p>
			</div>
		{/if}

		<div class="rounded-lg border border-line bg-panel p-4">
			<p class="text-body text-ink">
				{t.job.statusLine(job.proposalsEmitted, job.documentCount, t.job.statusWord[job.status])}
			</p>
			{#if renderedOutcomeNote}
				<p class="mt-1 text-body text-muted">{renderedOutcomeNote}</p>
			{/if}
		</div>

		<LiveProposalFeed {proposals} locale={data.locale} />

		{#if pendingCount > 0}
			<Button
				href={resolve(`/w/${data.universe.slug}/import/${job.id}/review`)}
				variant="secondary"
				class="self-start"
			>
				{t.job.reviewNow(pendingCount)}
			</Button>
		{/if}

		{#if isTerminal}
			<Button href={resolve(`/w/${data.universe.slug}`)} variant="link">
				{t.job.goToUniverse(data.universe.name)}
			</Button>
		{/if}
	</div>
</Page>
