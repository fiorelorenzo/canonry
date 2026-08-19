<script lang="ts">
	/**
	 * O1 = C (#283), the world home's second section, and the one with a guardrail attached:
	 * "Waiting for you as a quiet pointer into the existing proposal inbox, per C2 never a
	 * modal and never a second review surface".
	 *
	 * So every row here is a link and nothing else. There is no accept, no reject, no
	 * expandable diff and no count that can be clicked to make something happen: guardrail 1
	 * puts every AI-authored change behind an explicit accept per entry, and a home page that
	 * grew its own accept button would be a second place that write could come from. The rows
	 * are the inbox's own rows, from the inbox's own two queries and in the inbox's own words
	 * (`messages.proposals.inbox`), which is what keeps the two surfaces from drifting into
	 * two different accounts of the same pending work.
	 */
	import { resolve } from '$app/paths';
	import type { Messages } from '$lib/i18n';

	interface WaitingPlan {
		id: string;
		triggerEntityName: string | null;
		trigger: string;
		pending: number;
	}

	interface WaitingImportJob {
		id: string;
		playbook: string;
		pending: number;
	}

	let {
		universeSlug,
		plans,
		importJobs,
		totalPending,
		t,
		proposalsT
	}: {
		universeSlug: string;
		plans: WaitingPlan[];
		importJobs: WaitingImportJob[];
		totalPending: number;
		t: Messages['universe']['index']['home'];
		// The whole `proposals` group rather than just `inbox`, because #270 collapsed the two
		// disagreeing provenance renderers into one phrase that sits beside it: the row has to
		// read `inbox.from(provenance(...))` exactly as the inbox itself does, or the home and
		// the inbox go back to describing the same pending work two different ways.
		proposalsT: Messages['proposals'];
	} = $props();

	// Rendered only when something is actually pending, which the caller decides: this
	// component has no empty state of its own to get wrong.
	const shownPending = $derived(
		plans.reduce((sum, plan) => sum + plan.pending, 0) +
			importJobs.reduce((sum, job) => sum + job.pending, 0)
	);
</script>

<ul class="flex flex-col divide-y divide-line border-y border-line">
	{#each plans as plan (plan.id)}
		<li class="flex items-baseline gap-3 py-2.5 text-sm">
			<span class="min-w-0 flex-1 truncate text-ink-2">
				{proposalsT.inbox.from(proposalsT.provenance(plan.trigger, plan.triggerEntityName))}
			</span>
			<span class="shrink-0 font-mono text-xs text-muted tabular-nums">
				{proposalsT.inbox.pendingLabel(plan.pending)}
			</span>
			<a
				href={resolve(`/w/${universeSlug}/proposals/${plan.id}`)}
				class="shrink-0 text-xs font-medium text-accent-ink hover:underline"
			>
				{t.reviewLink} &rarr;
			</a>
		</li>
	{/each}
	{#each importJobs as job (job.id)}
		<li class="flex items-baseline gap-3 py-2.5 text-sm">
			<span class="min-w-0 flex-1 truncate text-ink-2"
				>{proposalsT.inbox.importFrom(job.playbook)}</span
			>
			<span class="shrink-0 font-mono text-xs text-muted tabular-nums">
				{proposalsT.inbox.pendingLabel(job.pending)}
			</span>
			<a
				href={resolve(`/w/${universeSlug}/import/${job.id}/review`)}
				class="shrink-0 text-xs font-medium text-accent-ink hover:underline"
			>
				{t.reviewLink} &rarr;
			</a>
		</li>
	{/each}
</ul>

<!-- Only when the rows above do not account for everything pending: with all of it on
     screen, each row already links into the inbox at the plan it belongs to, and a second
     link saying "review all 1" underneath one row is noise. When the section did run out of
     room, this is the honest "there is more" affordance and it counts every pending proposal
     in the world, not the ones shown. -->
{#if totalPending > shownPending}
	<a
		href={resolve(`/w/${universeSlug}/proposals`)}
		class="mt-2 inline-block text-xs font-medium text-accent-ink hover:underline"
	>
		{t.reviewAll(totalPending)}
	</a>
{/if}
