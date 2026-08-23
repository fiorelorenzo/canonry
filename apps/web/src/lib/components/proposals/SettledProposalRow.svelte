<script lang="ts">
	/**
	 * Issue #498 (V2 = A): "the page has to survive forty pending proposals... so the
	 * settled ones collapse". Once a candidate has an outcome, `ProposalQueue` stops
	 * rendering the full `ProposalDiffCard` (its whole diff, evidence popover and all) for
	 * it and renders this instead - one hairline-ruled row (V3) carrying only what a
	 * decided candidate still needs to say: what it was, and what happened to it. The full
	 * card is never lost - a settled proposal keeps its own permanent read view at
	 * `/w/[universe]/review/[proposal]` (issue #453), linked from a revision's history -
	 * this row is only the queue's own summary of the same fact.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';

	let {
		candidate,
		universeSlug,
		locale,
		onUndo
	}: {
		candidate: {
			id: string;
			kind: string;
			outcome: string;
			targetName: string | null;
			targetSlug: string | null;
			relatedName: string | null;
			rejectReason: string | null;
		};
		universeSlug: string;
		locale: Locale;
		/** Undoing only ever makes sense for an accepted candidate - absent for a
		 * rejected one, same convention `ProposalDiffCard` already uses. */
		onUndo?: () => void;
	} = $props();

	let t = $derived(messages(locale).proposals.diffCard);

	let label = $derived(
		candidate.kind === 'relation'
			? `${candidate.targetName ?? '?'} \u2192 ${candidate.relatedName ?? '?'}`
			: (candidate.targetName ?? t.newEntry)
	);
</script>

<div
	class="flex items-center justify-between gap-3 border-t border-line py-2 text-body"
	data-proposal-id={candidate.id}
>
	<div class="min-w-0 truncate text-ink-2">
		{#if candidate.targetSlug}
			<a href={resolve(`/w/${universeSlug}/e/${candidate.targetSlug}`)} class="hover:underline">
				{label}
			</a>
		{:else}
			{label}
		{/if}
	</div>
	<div class="flex flex-none items-center gap-2">
		{#if candidate.outcome === 'accepted'}
			<Badge variant="ok" class="font-mono">{t.accepted}</Badge>
			{#if onUndo}
				<button
					type="button"
					class="text-label text-muted underline hover:text-ink-2"
					onclick={onUndo}
				>
					{t.undo}
				</button>
			{/if}
		{:else if candidate.outcome === 'superseded' && candidate.rejectReason === 'endpoint_rejected'}
			<!-- Issue #613: a relation the GM never decided, settled because the entry it
			     needed was rejected. The `{:else}` below used to catch it and say "rejected",
			     which is wrong twice: it credits the GM with a decision they did not take, and
			     it is the one distinction `proposal_outcome`'s own comment says must stay
			     visible, since counting an undecided proposal as a rejection is what poisons
			     the accept rate. No danger treatment either, for the same reason. -->
			<span class="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-label text-ink-2">
				{t.supersededEndpointShort}
			</span>
		{:else}
			<span class="rounded-full bg-danger-bg px-2 py-0.5 font-mono text-label text-danger">
				{t.rejected}{candidate.rejectReason
					? ` \u00b7 ${t.rejectReasonLabel(candidate.rejectReason)}`
					: ''}
			</span>
		{/if}
	</div>
</div>
