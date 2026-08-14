<script lang="ts">
	/**
	 * D2 = B, "live feed of proposals" (docs/ux/DECISIONS.md, d2-estimate-and-progress.html):
	 * "each row is already a real, clickable proposal." D7's own onboarding mock shows the
	 * accept button inline on this exact row, so that is what this component does - the
	 * full multi-proposal queue (D4) is a separate surface (ReviewSurfaces' review link),
	 * not this one.
	 */
	import { proposalBadge, proposalDisplayName, type ProposalSummary } from './proposalView';

	let { proposals }: { proposals: ProposalSummary[] } = $props();
</script>

{#if proposals.length === 0}
	<p class="py-4 text-sm text-muted">No proposals yet.</p>
{:else}
	<ul class="flex flex-col divide-y divide-line">
		{#each proposals as proposal (proposal.id)}
			<li class="flex items-center justify-between gap-3 py-2.5">
				<div class="flex min-w-0 items-center gap-2">
					<span
						class="rounded-full border border-line-2 px-2 py-0.5 text-xs tracking-wide text-muted uppercase"
					>
						{proposalBadge(proposal)}
					</span>
					<span class="truncate text-sm text-ink" title={proposalDisplayName(proposal)}>
						{proposalDisplayName(proposal)}
					</span>
				</div>

				{#if proposal.outcome === 'pending'}
					<form method="POST" action="?/accept" class="shrink-0">
						<input type="hidden" name="proposalId" value={proposal.id} />
						<button
							type="submit"
							class="rounded-md bg-accent px-3 py-1 text-xs font-medium text-panel hover:opacity-90"
						>
							Accept
						</button>
					</form>
				{:else if proposal.outcome === 'accepted'}
					<span class="shrink-0 rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok">
						accepted
					</span>
				{:else}
					<span class="shrink-0 text-xs text-muted">{proposal.outcome}</span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
