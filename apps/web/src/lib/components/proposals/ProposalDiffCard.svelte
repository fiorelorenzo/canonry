<script lang="ts">
	/**
	 * #51: one proposal's diff (C4), evidence (C5) and decision (C6, C7). The focused card
	 * in `ProposalQueue`'s keyboard queue, or a single card wherever a queue of one is all
	 * that is needed.
	 */
	import { resolve } from '$app/paths';
	import EvidencePopover from './EvidencePopover.svelte';
	import RejectChips from './RejectChips.svelte';

	interface FactChangeLike {
		kind: 'added' | 'removed' | 'changed';
		statement: string;
		previousStatement?: string;
	}

	export interface DiffCandidateView {
		id: string;
		kind: string;
		outcome: string;
		rationale: string;
		rejectReason: string | null;
		targetName: string | null;
		targetType: string | null;
		targetSlug: string | null;
		relatedName: string | null;
		relationLabel: string | null;
		diff: FactChangeLike[];
		diffLayout: 'in-place' | 'side-by-side';
		evidenceViews: { quote: string | null; reason: string }[];
		evidenceForceOpen: boolean;
	}

	let {
		candidate,
		universeSlug,
		showRejectChips = false,
		onAccept,
		onReject,
		onRejectReason,
		onUndo
	}: {
		candidate: DiffCandidateView;
		universeSlug: string;
		/** True right after this card's own reject fired - C7's chip picker appears here,
		 * not blocking the queue (see ProposalQueue's handler). */
		showRejectChips?: boolean;
		onAccept: () => void;
		onReject: () => void;
		onRejectReason: (reason: string) => void;
		onUndo: () => void;
	} = $props();

	let showOld = $state(false);

	let title = $derived(
		candidate.kind === 'relation'
			? `${candidate.targetName ?? '?'} \u2192 ${candidate.relatedName ?? '?'}`
			: (candidate.targetName ?? 'New entry')
	);
</script>

<div class="card rounded-lg border border-line bg-panel p-4" data-proposal-id={candidate.id}>
	<header class="mb-2 flex items-start justify-between gap-3">
		<div>
			{#if candidate.targetSlug}
				<a
					href={resolve(`/u/${universeSlug}/e/${candidate.targetSlug}`)}
					class="text-base font-semibold text-ink hover:underline"
					target="_blank"
				>
					{title}
				</a>
			{:else}
				<h3 class="text-base font-semibold text-ink">{title}</h3>
			{/if}
			<p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
				<span class="rounded-full bg-panel-2 px-1.5 py-0.5 font-mono uppercase">
					{candidate.kind}
				</span>
				{#if candidate.targetType}
					<span class="rounded-full bg-accent-bg px-1.5 py-0.5 font-mono text-accent-ink uppercase">
						{candidate.targetType}
					</span>
				{/if}
				{#if candidate.relationLabel}
					<span>{candidate.relationLabel}</span>
				{/if}
				<span>{candidate.rationale}</span>
			</p>
		</div>
		{#if candidate.outcome === 'accepted'}
			<span class="rounded-full bg-ok-bg px-2 py-0.5 font-mono text-xs text-ok">accepted</span>
		{:else if candidate.outcome === 'rejected'}
			<span class="rounded-full bg-danger-bg px-2 py-0.5 font-mono text-xs text-danger">
				rejected{candidate.rejectReason ? ` \u00b7 ${candidate.rejectReason}` : ''}
			</span>
		{/if}
	</header>

	{#if candidate.kind === 'relation'}
		<p class="mb-3 rounded-md bg-ai-bg px-3 py-2 text-sm text-ink-2">
			<span class="font-semibold text-ink">{candidate.targetName}</span>
			<span class="mx-1 text-ai">{candidate.relationLabel}</span>
			<span class="font-semibold text-ink">{candidate.relatedName}</span>
			{#if candidate.evidenceViews.length > 0}
				<EvidencePopover views={candidate.evidenceViews} forceOpen={candidate.evidenceForceOpen} />
			{/if}
		</p>
	{:else if candidate.diffLayout === 'in-place'}
		<div class="mb-3 max-w-measure text-sm leading-relaxed text-ink-2">
			{#if candidate.diff.length > 0}
				<button
					type="button"
					class="mb-2 rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
					onclick={() => (showOld = !showOld)}
				>
					{showOld ? 'Show current wording' : 'Show what this replaced'}
				</button>
			{/if}
			{#each candidate.diff as change, i (i)}
				<p class="mb-1.5">
					{#if showOld}
						{#if change.kind === 'changed' || change.kind === 'removed'}
							<span class="rm text-muted line-through decoration-line-2"
								>{change.previousStatement ?? change.statement}</span
							>
						{/if}
					{:else if change.kind === 'added' || change.kind === 'changed'}
						<span class="rounded-sm bg-ai-bg px-1 py-0.5 text-ink">{change.statement}</span>
						{#if candidate.evidenceViews.length > 0 && i === 0}
							<EvidencePopover
								views={candidate.evidenceViews}
								forceOpen={candidate.evidenceForceOpen}
							/>
						{/if}
					{/if}
				</p>
			{/each}
		</div>
	{:else}
		<div class="mb-3 grid grid-cols-2 gap-4 text-sm">
			<div>
				<h4 class="mb-1 font-mono text-xs text-muted uppercase">Was</h4>
				<p class="text-ink-2">
					{candidate.diff
						.filter((c) => c.kind === 'changed' || c.kind === 'removed')
						.map((c) => c.previousStatement ?? c.statement)
						.join(' ')}
				</p>
			</div>
			<div>
				<h4 class="mb-1 font-mono text-xs text-muted uppercase">Now</h4>
				<p class="text-ink">
					{candidate.diff
						.filter((c) => c.kind === 'changed' || c.kind === 'added')
						.map((c) => c.statement)
						.join(' ')}
					{#if candidate.evidenceViews.length > 0}
						<EvidencePopover
							views={candidate.evidenceViews}
							forceOpen={candidate.evidenceForceOpen}
						/>
					{/if}
				</p>
			</div>
		</div>
	{/if}

	{#if candidate.outcome === 'pending'}
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:brightness-110"
				onclick={onAccept}
			>
				Accept
			</button>
			<button
				type="button"
				class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				onclick={onReject}
			>
				Reject
			</button>
		</div>
	{:else if candidate.outcome === 'accepted'}
		<button type="button" class="text-xs text-muted underline hover:text-ink-2" onclick={onUndo}>
			Undo
		</button>
	{/if}

	{#if showRejectChips}
		<div class="mt-3 border-t border-line pt-3">
			<RejectChips onPick={onRejectReason} />
		</div>
	{/if}
</div>
