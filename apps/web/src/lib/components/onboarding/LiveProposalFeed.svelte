<script lang="ts">
	/**
	 * D2 = B, "live feed of proposals" (docs/ux/DECISIONS.md, d2-estimate-and-progress.html):
	 * "each row is already a real, clickable proposal." D7's own onboarding mock shows the
	 * accept button inline on this exact row, so that is what this component does - the
	 * full multi-proposal queue (D4) is a separate surface (ReviewSurfaces' review link),
	 * not this one.
	 *
	 * V9 (round seventeen, #501): the row's own accept button turning into a settled
	 * badge is exactly "a state that changed" (docs/ux/MOTION.md), so the badge fades in
	 * on the fade token rather than replacing the button in place, and the mark inside
	 * it draws itself on the move token (`AcceptMark`) rather than appearing whole.
	 */
	import { enhance } from '$app/forms';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { AcceptMark } from '$lib/components/ui/accept-mark';
	import { proposalBadge, proposalDisplayName, type ProposalSummary } from './proposalView';

	let { proposals, locale }: { proposals: ProposalSummary[]; locale: Locale } = $props();

	let t = $derived(messages(locale).import.liveFeed);

	// Keyed by proposal id, mirroring AuditFlagsPanel.svelte's own per-row pending map -
	// several of these rows can be mid-accept independently.
	let accepting = $state<Record<string, boolean>>({});
</script>

{#if proposals.length === 0}
	<EmptyState kind="derived" message={t.empty} explanation={t.explanation} />
{:else}
	<ul class="flex flex-col divide-y divide-line">
		{#each proposals as proposal (proposal.id)}
			<li class="flex items-center justify-between gap-3 py-2.5">
				<div class="flex min-w-0 items-center gap-2">
					<span
						class="rounded-full border border-line-2 px-2 py-0.5 text-xs tracking-wide text-muted uppercase"
					>
						{proposalBadge(proposal, t.badge)}
					</span>
					<span
						class="truncate text-sm text-ink"
						title={proposalDisplayName(proposal, t.untitledProposal)}
					>
						{proposalDisplayName(proposal, t.untitledProposal)}
					</span>
				</div>

				{#if proposal.outcome === 'pending'}
					<form
						method="POST"
						action="?/accept"
						class="shrink-0"
						use:enhance={() => {
							accepting = { ...accepting, [proposal.id]: true };
							return async ({ update }) => {
								await update();
							};
						}}
					>
						<input type="hidden" name="proposalId" value={proposal.id} />
						<Button type="submit" size="sm" disabled={accepting[proposal.id]}>
							{accepting[proposal.id] ? t.accepting : t.accept}
						</Button>
					</form>
				{:else if proposal.outcome === 'accepted'}
					<Badge variant="ok" class="shrink-0 animate-in gap-1 duration-fade ease-arrive fade-in-0">
						<AcceptMark data-icon="inline-start" />
						{t.accepted}
					</Badge>
				{:else}
					<span class="shrink-0 text-xs text-muted">{t.outcome[proposal.outcome]}</span>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
