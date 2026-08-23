<script lang="ts">
	/**
	 * #51: one proposal's diff (C4), evidence (C5) and decision (C6, C7). The focused card
	 * in `ProposalQueue`'s keyboard queue, or a single card wherever a queue of one is all
	 * that is needed.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';
	import { InlineLink } from '$lib/components/ui/link';
	import EvidencePopover from './EvidencePopover.svelte';
	import RejectChips from './RejectChips.svelte';
	import type { EvidenceCaveat, EvidenceView } from './evidence';
	import type { ProseDiff } from './proseDiff';

	interface DiffCandidateWaitingRelationView {
		fromName: string | null;
		toName: string | null;
		rationale: string;
		evidenceViews: EvidenceView[];
		evidenceCaveat: EvidenceCaveat | null;
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

	/** Issue #628: `RelationTypeNotAdmittedError`'s own fields, minus `proposalId` (this
	 * card already has the candidate's own `id`). Null until an accept has actually
	 * failed this way - the server load always sets it null, `ProposalQueue` is the one
	 * place that ever populates it, from a failed `?/accept` submit. */
	export interface DiffCandidateNotAdmittedView {
		relationTypeId: string;
		typeLabel: string;
		fromType: string;
		toType: string;
		addFrom: string | null;
		addTo: string | null;
		shipped: boolean;
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
		/** Issue #613: the entries this relation waits on, by name, while they are still
		 * this import's own pending proposals. Empty for every other kind and for a
		 * relation whose ends are already canon. */
		waitingOnEntries: string[];
		relationLabel: string | null;
		/** #196: `relationType.key`, null for anything that is not a plain `relation`
		 * proposal - mirrors `relationLabel`'s own null case. */
		relationKey: string | null;
		/** Q1 (round twelve): the whole diff, every changed region with its context, as
		 * `proseDiff` derived it from the patch's `before` and `after`. */
		diff: ProseDiff;
		evidenceViews: EvidenceView[];
		evidenceCaveat: EvidenceCaveat | null;
		relationVocab: DiffCandidateRelationVocabView | null;
		/** Issue #628: optional so nothing else that structurally satisfies this interface
		 * has to be touched - see this file's own doc comment on
		 * `DiffCandidateNotAdmittedView`. */
		notAdmitted?: DiffCandidateNotAdmittedView | null;
	}

	let {
		candidate,
		universeSlug,
		showRejectChips = false,
		locale,
		headingLevel,
		onAccept,
		onReject,
		onRejectReason,
		onUndo,
		onWidenAndAccept
	}: {
		candidate: DiffCandidateView;
		universeSlug: string;
		/** True right after this card's own reject fired - C7's chip picker appears here,
		 * not blocking the queue (see ProposalQueue's handler). */
		showRejectChips?: boolean;
		locale: Locale;
		/** Issue #526: the page around this card decides how deep its own title nests,
		 * because two callers put it at different depths - `h2` directly under a page's
		 * own `h1` (the single-proposal route, and a plan/import queue whose one implicit
		 * group renders no heading of its own), `h3` under the inbox's own group heading
		 * (`ProposalQueue`, whenever `group.heading` is set). No default: a hardcoded
		 * level was only ever right for whichever caller last touched this file, and #526
		 * is exactly that drift made visible. */
		headingLevel: 2 | 3;
		/** Issue #453: all four are absent on the read-only settled-proposal page
		 * (`review/[proposal]/+page.svelte`), reached from a revision's own history link -
		 * guardrail 3 wants that proposal's evidence readable there, not a second decision
		 * surface days after the first one already settled it. Every existing caller
		 * (`ProposalQueue`, `InlineProposalReview`) still passes all four. */
		onAccept?: () => void;
		onReject?: () => void;
		onRejectReason?: (reason: string) => void;
		onUndo?: () => void;
		/** Issue #628: the button that names both effects - widen the type, then accept
		 * the relation. Only `ProposalQueue` ever wires this: the read-only settled page
		 * above has no accept to fail in the first place, so it never has a candidate
		 * carrying `notAdmitted`. */
		onWidenAndAccept?: () => void;
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

	/** C5's popover hangs off the first changed row, as it did off the first changed
	 * sentence before Q1: one popover per proposal, on the evidence's own first claim,
	 * rather than one per region repeating the same sources. */
	let firstChangedRow = $derived(
		candidate.diff.rows.findIndex((row) => row.kind !== 'gap' && row.kind !== 'kept')
	);

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

<div class="border-t border-line pt-4" data-proposal-id={candidate.id}>
	<header class="mb-2 flex items-start justify-between gap-3">
		<div>
			{#if candidate.targetSlug}
				<a
					href={resolve(`/w/${universeSlug}/e/${candidate.targetSlug}`)}
					class="text-title font-semibold text-ink hover:underline"
					target="_blank"
				>
					{title}
				</a>
			{:else}
				<svelte:element this={`h${headingLevel}`} class="text-title font-semibold text-ink">
					{title}
				</svelte:element>
			{/if}
			<p class="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-muted">
				<span class="rounded-full bg-panel-2 px-1.5 py-0.5 font-mono uppercase">
					{t.diffCard.kindLabel(candidate.kind)}
				</span>
				{#if candidate.targetType}
					<Badge variant="accent" class="font-mono uppercase">
						{t.diffCard.entityTypeLabel(candidate.targetType)}
					</Badge>
				{/if}
				{#if candidate.relationLabel && !candidate.relationVocab}
					<span>{relationLabel}</span>
				{/if}
				<span>{candidate.rationale}</span>
			</p>
		</div>
		{#if candidate.outcome === 'accepted'}
			<Badge variant="ok" class="font-mono">{t.diffCard.accepted}</Badge>
		{:else if candidate.outcome === 'rejected'}
			<span class="rounded-full bg-danger-bg px-2 py-0.5 font-mono text-label text-danger">
				{t.diffCard.rejected}{candidate.rejectReason
					? ` \u00b7 ${t.diffCard.rejectReasonLabel(candidate.rejectReason)}`
					: ''}
			</span>
		{:else if candidate.outcome === 'superseded' && candidate.rejectReason === 'endpoint_rejected'}
			<!-- Issue #613: a relation whose entry the GM rejected. It is settled, and it says
			     so, because the alternative was a row sitting pending forever against an entry
			     that is never coming. Not the danger treatment: the GM rejected the entry, not
			     this, and nothing here failed. -->
			<span class="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-label text-ink-2">
				{t.diffCard.supersededEndpoint}
			</span>
		{/if}
	</header>

	{#if candidate.relationVocab}
		{@const vocab = candidate.relationVocab}
		<div class="mb-3 max-w-measure text-body text-ink-2">
			<h4 class="mb-1 font-mono text-label text-muted uppercase">
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
			<!-- Round eleven P3 (#344): this box holds what the proposal would change the
				vocabulary to, so it is the diff's claim and it wears the diff's own tokens.
				T4 (round fifteen, #431): the words inside it that the model chose no longer
				keep the copilot's hue - round sixteen U10 (#454) deleted that hue outright,
				so nothing on this card could carry it even by mistake. -->
			<div class="rounded-md border border-diff-line bg-diff-bg px-3 py-2">
				{#if vocab.kind === 'relation_type_reuse'}
					<p class="text-ink">{t.relationVocab.reuseType(vocabLabel, vocabInverseLabel)}</p>
					{#if vocab.proposedLabel}
						<p class="mt-1 text-label text-ink-2">
							"{vocab.proposedLabel}" &rarr; "{vocabLabel}"
						</p>
					{/if}
				{:else}
					<p class="font-semibold text-ink">{vocabLabel} / {vocabInverseLabel}</p>
				{/if}
				{#if vocab.cardinality}
					<p class="mt-1 text-label text-ink-2">
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
				<h4 class="mb-1.5 font-mono text-label text-muted uppercase">
					{t.relationVocab.waitingCount(vocab.relations.length)}
				</h4>
				<ul class="space-y-1.5">
					{#each vocab.relations as relation, i (i)}
						<li class="rounded-md bg-panel-2 px-3 py-2 text-body text-ink-2">
							<span class="font-semibold text-ink">{relation.fromName ?? '?'}</span>
							<!-- T4 (round fifteen, #431): the type name is wording the model proposed, but
							it no longer wears the copilot's hue - the card already says "not accepted"
							with its kind badge and its Accept/Reject, and a vocabulary question's own
							diff-bg box above carries the rest of the claim. -->
							<span class="mx-1">{vocabLabel}</span>
							<span class="font-semibold text-ink">{relation.toName ?? '?'}</span>
							{#if relation.evidenceViews.length > 0}
								<EvidencePopover
									views={relation.evidenceViews}
									caveat={relation.evidenceCaveat}
									{locale}
								/>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else if candidate.kind === 'relation'}
		<p class="mb-3 rounded-md border border-diff-line bg-diff-bg px-3 py-2 text-body text-ink-2">
			<span class="font-semibold text-ink">{candidate.targetName}</span>
			<!-- T4 (round fifteen, #431): as above, no copilot hue on the relation's own
				label - the box's diff-bg treatment already says this is the proposal. -->
			<span class="mx-1">{relationLabel}</span>
			<span class="font-semibold text-ink">{candidate.relatedName}</span>
			{#if candidate.evidenceViews.length > 0}
				<EvidencePopover
					views={candidate.evidenceViews}
					caveat={candidate.evidenceCaveat}
					{locale}
				/>
			{/if}
		</p>
	{:else if candidate.diff.rows.length > 0}
		<!-- Q1 (round twelve, docs/ux/DECISIONS.md): C4's toggle is repealed, so every
		     changed region is here at once with the unchanged sentences around it, and
		     comparing is reading rather than remembering. `proseDiff` decided what a region
		     is and what context it keeps; this only paints it.

		     T4 (round fifteen, #431) retired the second channel this used to run on: added
		     text no longer carries C1's dashed underline in the copilot's own hue, and
		     neither does a relation label above. A proposal card already says "not
		     accepted" with its kind badge and its Accept/Reject, so it never needed a
		     second signal - round sixteen U10 (#454) went on to delete that hue outright,
		     since C1's own mark stays reserved for a pending sentence inside the entry's
		     own body (`entryMarking.ts`), the one place nothing else on screen says so, and
		     now runs on this same `--color-diff-line` rather than a hue of its own.

		     The diff now reads the way every developer already reads one, entirely on P3's
		     hue-less pair: removals struck through in `--color-diff-line` (3.18:1 against
		     the wash and 3.02:1 in dark, clear of the 3:1 a non-text mark needs), additions
		     bold in `--color-ink`. Bold rather than underlined, because this product's prose
		     already underlines links and mentions, and a third underline in one paragraph
		     was a puzzle. The wash and its change bar (`--color-diff-bg`/`--color-diff-line`)
		     are still the one channel saying "this is what changed", at 1.44:1 against the
		     card in light and 1.34:1 in dark, with the bar at 4.57:1 and 4.03:1 - a reader
		     who cannot see colour at all still has the strike, the bold weight and the
		     labels below. -->
		<div class="mb-3 max-w-measure text-body leading-relaxed text-ink-2">
			{#if candidate.diff.regions > 1}
				<!-- `text-muted` is 4.13:1 on this card at 11px, so these two labels take
				     `text-ink-2` (9.63:1 light, 9.54:1 dark) rather than adding a fresh AA
				     failure to the ten this palette already has at muted. -->
				<p class="mb-2 font-mono text-label text-ink-2">
					{t.diffCard.changedRegions(candidate.diff.regions)}
				</p>
			{/if}
			{#each candidate.diff.rows as row, i (i)}
				{#if row.kind === 'gap'}
					<p class="my-2 flex items-center gap-2 pl-3 font-mono text-label text-ink-2">
						<span aria-hidden="true" class="h-px w-4 bg-line-2"></span>
						{t.diffCard.unchangedUnits(row.units)}
					</p>
				{:else if row.kind === 'kept'}
					<p
						class="mb-1.5 border-l-2 border-transparent pl-3"
						class:font-semibold={row.heading}
						class:text-ink={row.heading}
					>
						{row.text}
					</p>
				{:else}
					<p
						class="mb-1.5 border-l-2 border-diff-line bg-diff-bg py-0.5 pr-2 pl-3"
						class:font-semibold={row.heading}
					>
						<!-- Removal and addition are carried by strikethrough and by weight, so the
					     one reader who gets neither is the one using a screen reader: this says
					     it in words. -->
						<!-- The trailing space is an entity because a mustache holding a string
					     literal is a lint error, and without it a screen reader runs the label
					     into the sentence. -->
						<span class="sr-only"
							>{row.kind === 'removed'
								? t.diffCard.removedLabel
								: row.kind === 'added'
									? t.diffCard.addedLabel
									: t.diffCard.changedLabel}&#32;</span
						>
						{#if row.kind === 'removed'}
							<span class="text-ink-2 line-through decoration-diff-line decoration-2"
								>{row.text}</span
							>
						{:else if row.kind === 'added'}
							<span class="font-semibold text-ink">{row.text}</span>
						{:else}
							<!-- The words inside a reworded sentence, in the order it reads: what
						     leaves is struck where it stood, what arrives is bold, and the words
						     that survive carry neither. -->
							{#each row.spans as span, s (s)}
								<!-- The space between two runs is written here rather than left to the
							     markup: whitespace between sibling blocks does not survive into the
							     rendered text, which is how "kept bywhoever is" happens. -->
								{#if span.kind === 'kept'}
									<span>{s > 0 ? ' ' : ''}{span.text}</span>
								{:else if span.kind === 'removed'}
									<span class="text-ink-2 line-through decoration-diff-line decoration-2"
										>{s > 0 ? ' ' : ''}{span.text}</span
									>
								{:else}
									<span class="font-semibold text-ink">{s > 0 ? ' ' : ''}{span.text}</span>
								{/if}
							{/each}
						{/if}
						{#if candidate.evidenceViews.length > 0 && i === firstChangedRow}
							<EvidencePopover
								views={candidate.evidenceViews}
								caveat={candidate.evidenceCaveat}
								{locale}
							/>
						{/if}
					</p>
				{/if}
			{/each}
		</div>
	{/if}

	{#if candidate.waitingOnEntries.length > 0 && candidate.outcome === 'pending'}
		<!-- Issue #613: this relation names an entry the same import is still proposing, so
		     accepting it now would be refused by `acceptProposal`. Saying which entry, and
		     withholding Accept rather than leaving a button that errors, is what makes the
		     ordering readable instead of a wall a GM walks into. Reject stays available: a
		     link the GM does not want is still a decision they can take now. -->
		<p class="mb-3 rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-body text-ink-2">
			{t.diffCard.waitingOnEntries(candidate.waitingOnEntries.join(', '))}
		</p>
	{/if}

	{#if candidate.notAdmitted && candidate.outcome === 'pending'}
		{@const notAdmitted = candidate.notAdmitted}
		<!-- Issue #628: #191's admission check runs against the real endpoint types at
		     accept time, the first moment they are known - propose time (packages/copilot,
		     packages/import) only ever guesses. This is that check's refusal, reached from
		     a failed `?/accept` (`ProposalQueue`'s own enhance handler), in the same
		     visual family as the waitingOnEntries notice above: something still has to be
		     resolved before this link can be accepted, not a red error. -->
		<p class="mb-3 rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink-2">
			{t.diffCard.notAdmittedNotice(
				notAdmitted.typeLabel,
				t.diffCard.entityTypeLabel(notAdmitted.fromType),
				t.diffCard.entityTypeLabel(notAdmitted.toType)
			)}
			{#if notAdmitted.shipped}
				{t.diffCard.notAdmittedShipped(notAdmitted.typeLabel)}
				<InlineLink href={resolve(`/w/${universeSlug}/settings/relations`)}>
					{t.diffCard.notAdmittedShippedLink}
				</InlineLink>
			{/if}
		</p>
	{/if}

	{#if candidate.outcome === 'pending' && candidate.waitingOnEntries.length > 0 && onReject}
		<button
			type="button"
			class="min-h-11 rounded-md border border-line-2 px-3 text-body text-ink-2 hover:bg-panel-2 sm:min-h-0 sm:py-1.5"
			onclick={onReject}
		>
			{t.diffCard.reject}
		</button>
	{:else if candidate.outcome === 'pending' && onAccept && onReject}
		<!-- Issue #148 (I10 = B): C6's keyboard queue (j/k/a/r/u) doesn't reach a
		     phone, so below `sm` these are the primary way to decide - full width,
		     44px minimum, side by side rather than the compact auto-width pair a
		     mouse gets at `sm` and up. -->
		<div class="flex gap-2">
			<button
				type="button"
				class="min-h-11 flex-1 rounded-md bg-accent px-3 text-body font-medium text-panel hover:brightness-110 sm:min-h-0 sm:flex-none sm:py-1.5"
				onclick={onAccept}
			>
				{t.diffCard.accept}
			</button>
			{#if candidate.notAdmitted && !candidate.notAdmitted.shipped && onWidenAndAccept}
				<!-- Issue #628: the label names both effects it takes - widening the type is
				     content, and guardrail 1 says the GM has to consent to it explicitly, which
				     naming it here (rather than widening silently inside a plain "Accept" retry)
				     is what makes clicking this button that consent. -->
				<button
					type="button"
					class="min-h-11 flex-1 rounded-md border border-accent px-3 text-sm font-medium text-accent hover:bg-accent-bg sm:min-h-0 sm:flex-none sm:py-1.5"
					onclick={onWidenAndAccept}
				>
					{t.diffCard.notAdmittedWidenButton}
				</button>
			{/if}
			<button
				type="button"
				class="min-h-11 flex-1 rounded-md border border-line-2 px-3 text-body text-ink-2 hover:bg-panel-2 sm:min-h-0 sm:flex-none sm:py-1.5"
				onclick={onReject}
			>
				{t.diffCard.reject}
			</button>
		</div>
	{:else if candidate.outcome === 'accepted' && onUndo}
		<button type="button" class="text-label text-muted underline hover:text-ink-2" onclick={onUndo}>
			{t.diffCard.undo}
		</button>
	{/if}

	{#if showRejectChips && onRejectReason}
		<div class="mt-3 border-t border-line pt-3">
			<RejectChips onPick={onRejectReason} {locale} />
		</div>
	{/if}
</div>
