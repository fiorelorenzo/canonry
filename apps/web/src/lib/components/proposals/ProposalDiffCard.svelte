<script lang="ts">
	/**
	 * #51: one proposal's diff (C4), evidence (C5) and decision (C6, C7). The focused card
	 * in `ProposalQueue`'s keyboard queue, or a single card wherever a queue of one is all
	 * that is needed.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import EvidencePopover from './EvidencePopover.svelte';
	import RejectChips from './RejectChips.svelte';
	import type { EvidenceView } from './evidence';

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
		evidenceViews: EvidenceView[];
		evidenceForceOpen: boolean;
	}

	let {
		candidate,
		universeSlug,
		showRejectChips = false,
		locale,
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
		locale: Locale;
		onAccept: () => void;
		onReject: () => void;
		onRejectReason: (reason: string) => void;
		onUndo: () => void;
	} = $props();

	let t = $derived(messages(locale).proposals);

	let showOld = $state(false);

	let title = $derived(
		candidate.kind === 'relation'
			? `${candidate.targetName ?? '?'} \u2192 ${candidate.relatedName ?? '?'}`
			: (candidate.targetName ?? t.diffCard.newEntry)
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
					{t.diffCard.kindLabel(candidate.kind)}
				</span>
				{#if candidate.targetType}
					<span class="rounded-full bg-accent-bg px-1.5 py-0.5 font-mono text-accent-ink uppercase">
						{t.diffCard.entityTypeLabel(candidate.targetType)}
					</span>
				{/if}
				{#if candidate.relationLabel}
					<span>{candidate.relationLabel}</span>
				{/if}
				<span>{candidate.rationale}</span>
			</p>
		</div>
		{#if candidate.outcome === 'accepted'}
			<span class="rounded-full bg-ok-bg px-2 py-0.5 font-mono text-xs text-ok"
				>{t.diffCard.accepted}</span
			>
		{:else if candidate.outcome === 'rejected'}
			<span class="rounded-full bg-danger-bg px-2 py-0.5 font-mono text-xs text-danger">
				{t.diffCard.rejected}{candidate.rejectReason
					? ` \u00b7 ${t.diffCard.rejectReasonLabel(candidate.rejectReason)}`
					: ''}
			</span>
		{/if}
	</header>

	{#if candidate.kind === 'relation'}
		<p class="mb-3 rounded-md bg-ai-bg px-3 py-2 text-sm text-ink-2">
			<span class="font-semibold text-ink">{candidate.targetName}</span>
			<span class="mx-1 text-ai">{candidate.relationLabel}</span>
			<span class="font-semibold text-ink">{candidate.relatedName}</span>
			{#if candidate.evidenceViews.length > 0}
				<EvidencePopover
					views={candidate.evidenceViews}
					forceOpen={candidate.evidenceForceOpen}
					{locale}
				/>
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
					{showOld ? t.diffCard.showCurrentWording : t.diffCard.showWhatThisReplaced}
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
								{locale}
							/>
						{/if}
					{/if}
				</p>
			{/each}
		</div>
	{:else}
		<div class="mb-3 grid grid-cols-2 gap-4 text-sm">
			<div>
				<h4 class="mb-1 font-mono text-xs text-muted uppercase">{t.diffCard.was}</h4>
				<p class="text-ink-2">
					{candidate.diff
						.filter((c) => c.kind === 'changed' || c.kind === 'removed')
						.map((c) => c.previousStatement ?? c.statement)
						.join(' ')}
				</p>
			</div>
			<div>
				<h4 class="mb-1 font-mono text-xs text-muted uppercase">{t.diffCard.now}</h4>
				<p class="text-ink">
					{candidate.diff
						.filter((c) => c.kind === 'changed' || c.kind === 'added')
						.map((c) => c.statement)
						.join(' ')}
					{#if candidate.evidenceViews.length > 0}
						<EvidencePopover
							views={candidate.evidenceViews}
							forceOpen={candidate.evidenceForceOpen}
							{locale}
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
				{t.diffCard.accept}
			</button>
			<button
				type="button"
				class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				onclick={onReject}
			>
				{t.diffCard.reject}
			</button>
		</div>
	{:else if candidate.outcome === 'accepted'}
		<button type="button" class="text-xs text-muted underline hover:text-ink-2" onclick={onUndo}>
			{t.diffCard.undo}
		</button>
	{/if}

	{#if showRejectChips}
		<div class="mt-3 border-t border-line pt-3">
			<RejectChips onPick={onRejectReason} {locale} />
		</div>
	{/if}
</div>
