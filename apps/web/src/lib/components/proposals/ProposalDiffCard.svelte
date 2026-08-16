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

	interface DiffCandidateWaitingRelationView {
		fromName: string | null;
		toName: string | null;
		rationale: string;
		evidenceViews: EvidenceView[];
		evidenceForceOpen: boolean;
	}

	/** The card's own mirror of `$lib/server/proposals.ts`'s `DiffCandidateRelationVocab` -
	 * set only for the three relation-type vocabulary kinds (issue #190, K1: reuse an
	 * existing type, widen one, or propose a brand new one), carrying every relation
	 * waiting on the answer with its own name pair and evidence, the same shape a plain
	 * `relation` proposal already renders below. */
	export interface DiffCandidateRelationVocabView {
		kind: 'relation_type_reuse' | 'relation_type_widen' | 'relation_type_new';
		/** #196: the existing type's catalogue key for reuse/widen, null for
		 * `relation_type_new` - see `$lib/server/proposals.ts`'s `RelationVocabCandidate`. */
		key: string | null;
		label: string;
		inverseLabel: string;
		cardinality: string | null;
		allowedFrom: string[];
		allowedTo: string[];
		/** `relation_type_reuse` only: the label the model actually used. */
		proposedLabel: string | null;
		/** `relation_type_widen` only: the full pair accepting would add. */
		addFrom: string | null;
		addTo: string | null;
		relations: DiffCandidateWaitingRelationView[];
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
		/** #196: `relationType.key`, null for anything that is not a plain `relation`
		 * proposal - mirrors `relationLabel`'s own null case. */
		relationKey: string | null;
		diff: FactChangeLike[];
		diffLayout: 'in-place' | 'side-by-side';
		evidenceViews: EvidenceView[];
		evidenceForceOpen: boolean;
		relationVocab: DiffCandidateRelationVocabView | null;
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

	// #196 (decision L1): the shipped ten's words come from the catalogue, keyed on
	// `relationType.key`; a universe's own type has no entry and `?? candidate.relationLabel`/
	// `?? candidate.relationVocab.label` falls back to the stored text exactly as authored.
	let relationTypeLabel = $derived(messages(locale).relationTypeLabel);
	let vocabPair = $derived(
		candidate.relationVocab?.key ? relationTypeLabel(candidate.relationVocab.key) : undefined
	);
	let vocabLabel = $derived(vocabPair?.label ?? candidate.relationVocab?.label ?? '');
	let vocabInverseLabel = $derived(
		vocabPair?.inverseLabel ?? candidate.relationVocab?.inverseLabel ?? ''
	);
	let relationLabel = $derived(
		(candidate.relationKey ? relationTypeLabel(candidate.relationKey)?.label : undefined) ??
			candidate.relationLabel
	);

	let showOld = $state(false);

	let title = $derived(
		candidate.relationVocab
			? `${vocabLabel} / ${vocabInverseLabel}`
			: candidate.kind === 'relation'
				? `${candidate.targetName ?? '?'} \u2192 ${candidate.relatedName ?? '?'}`
				: (candidate.targetName ?? t.diffCard.newEntry)
	);

	/** Cross product of the two admitted-type arrays, translated and joined - the same
	 * "character -> character, place -> character" shape `relationVocab.admitsCurrently`/
	 * `newAdmits` wrap into a full sentence (issue #190, K1). Structured input, formatted
	 * sentence out, same split every other localized string in this card keeps. */
	function pairsLabel(allowedFrom: string[], allowedTo: string[]): string {
		const pairs: string[] = [];
		for (const from of allowedFrom) {
			for (const to of allowedTo) {
				pairs.push(`${t.diffCard.entityTypeLabel(from)} \u2192 ${t.diffCard.entityTypeLabel(to)}`);
			}
		}
		return pairs.join(', ');
	}
</script>

<div class="card rounded-lg border border-line bg-panel p-4" data-proposal-id={candidate.id}>
	<header class="mb-2 flex items-start justify-between gap-3">
		<div>
			{#if candidate.targetSlug}
				<a
					href={resolve(`/w/${universeSlug}/e/${candidate.targetSlug}`)}
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
				{#if candidate.relationLabel && !candidate.relationVocab}
					<span>{relationLabel}</span>
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

	{#if candidate.relationVocab}
		{@const vocab = candidate.relationVocab}
		<div class="mb-3 max-w-measure text-sm text-ink-2">
			<h4 class="mb-1 font-mono text-xs text-muted uppercase">
				{vocab.kind === 'relation_type_reuse'
					? t.relationVocab.reuseHeading
					: vocab.kind === 'relation_type_widen'
						? t.relationVocab.widenHeading
						: t.relationVocab.newHeading}
			</h4>
			<p class="mb-2">
				{vocab.kind === 'relation_type_reuse'
					? t.relationVocab.askReuse
					: vocab.kind === 'relation_type_widen'
						? t.relationVocab.askWiden
						: t.relationVocab.askNew}
			</p>
			<div class="rounded-md bg-ai-bg px-3 py-2">
				{#if vocab.kind === 'relation_type_reuse'}
					<p class="text-ink">{t.relationVocab.reuseType(vocabLabel, vocabInverseLabel)}</p>
					{#if vocab.proposedLabel}
						<p class="mt-1 text-xs text-muted">
							"{vocab.proposedLabel}" &rarr; "{vocabLabel}"
						</p>
					{/if}
				{:else}
					<p class="font-semibold text-ink">{vocabLabel} / {vocabInverseLabel}</p>
				{/if}
				{#if vocab.cardinality}
					<p class="mt-1 text-xs text-muted">
						{t.relationVocab.cardinalityLabel(vocab.cardinality)}
					</p>
				{/if}
				{#if vocab.kind === 'relation_type_widen'}
					<p class="mt-1">
						{t.relationVocab.admitsCurrently(pairsLabel(vocab.allowedFrom, vocab.allowedTo))}
					</p>
					{#if vocab.addFrom && vocab.addTo}
						<p class="mt-1 text-ink">
							{t.relationVocab.widensTo(
								t.diffCard.entityTypeLabel(vocab.addFrom),
								t.diffCard.entityTypeLabel(vocab.addTo)
							)}
						</p>
					{/if}
				{:else if vocab.kind === 'relation_type_new'}
					<p class="mt-1">
						{t.relationVocab.newAdmits(pairsLabel(vocab.allowedFrom, vocab.allowedTo))}
					</p>
				{/if}
			</div>
		</div>

		{#if vocab.relations.length > 0}
			<div class="mb-3">
				<h4 class="mb-1.5 font-mono text-xs text-muted uppercase">
					{t.relationVocab.waitingCount(vocab.relations.length)}
				</h4>
				<ul class="space-y-1.5">
					{#each vocab.relations as relation, i (i)}
						<li class="rounded-md bg-panel-2 px-3 py-2 text-sm text-ink-2">
							<span class="font-semibold text-ink">{relation.fromName ?? '?'}</span>
							<span class="mx-1 text-ai">{vocabLabel}</span>
							<span class="font-semibold text-ink">{relation.toName ?? '?'}</span>
							{#if relation.evidenceViews.length > 0}
								<EvidencePopover
									views={relation.evidenceViews}
									forceOpen={relation.evidenceForceOpen}
									{locale}
								/>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else if candidate.kind === 'relation'}
		<p class="mb-3 rounded-md bg-ai-bg px-3 py-2 text-sm text-ink-2">
			<span class="font-semibold text-ink">{candidate.targetName}</span>
			<span class="mx-1 text-ai">{relationLabel}</span>
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
		<!-- Issue #148 (I10 = B): C6's keyboard queue (j/k/a/r/u) doesn't reach a
		     phone, so below `sm` these are the primary way to decide - full width,
		     44px minimum, side by side rather than the compact auto-width pair a
		     mouse gets at `sm` and up. -->
		<div class="flex gap-2">
			<button
				type="button"
				class="min-h-11 flex-1 rounded-md bg-accent px-3 text-sm font-medium text-panel hover:brightness-110 sm:min-h-0 sm:flex-none sm:py-1.5"
				onclick={onAccept}
			>
				{t.diffCard.accept}
			</button>
			<button
				type="button"
				class="min-h-11 flex-1 rounded-md border border-line-2 px-3 text-sm text-ink-2 hover:bg-panel-2 sm:min-h-0 sm:flex-none sm:py-1.5"
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
