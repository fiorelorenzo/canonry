<script lang="ts" module>
	import type { DiffCandidateNotAdmittedView, DiffCandidateView } from './ProposalDiffCard.svelte';

	/** The server's `DiffCandidate` carries two fields `ProposalDiffCard` itself never
	 * reads - `planId` (`AwaitingDiffCard`'s own "open the plan" link) and
	 * `awaitingDiff` (this file's own branch between `AwaitingDiffCard`,
	 * `SettledProposalRow` and `ProposalDiffCard`) - so the queue's own candidate type
	 * extends the card's view rather than widening it there. A `QueueCandidateView`
	 * still satisfies `DiffCandidateView` structurally, so passing one to
	 * `ProposalDiffCard` needs no narrowing. */
	export interface QueueCandidateView extends DiffCandidateView {
		planId: string | null;
		awaitingDiff: boolean;
	}

	export interface ProposalGroupView {
		/** The plan or import job id this group renders - the DOM anchor for its
		 * collapse toggle, never shown. */
		id: string;
		/** The group's own heading line (the provenance sentence, or an import job's
		 * playbook). Empty for a queue that only ever holds one implicit group - the plan
		 * route's own post-diff queue and the import review route, both already scoped to
		 * one plan/job by their URL - which renders with no group header at all, exactly
		 * as C6's queue always has. */
		heading: string;
		/** A meta line under the heading - entry/proposal counts, when it arrived. Blank
		 * where `heading` is. */
		meta: string;
		/** The import job id whose own review page (`/w/[universe]/import/[job]/review`)
		 * this group's header links to, for D4's type filter the inbox itself does not
		 * offer. Null for a propagation-plan group, and for a queue that only ever
		 * holds one implicit group. */
		importJobId: string | null;
		candidates: QueueCandidateView[];
	}
</script>

<script lang="ts">
	/**
	 * Round seventeen V2 = A (docs/design/DECISIONS.md), issue #498: "the inbox is the
	 * queue. Every waiting proposal, its diff, accept in place." This is C6's `j k a r u`
	 * queue widened from "the current candidate, one at a time, behind a row of numbered
	 * jump buttons" (issue #480's own description of what this component used to be) to
	 * "every pending candidate, visible at once, grouped under the plan that produced it".
	 * `j`/`k` still move a keyboard focus and `a`/`r` still decide exactly one entry
	 * (guardrail 1: no bulk control lives here, not behind a dialog, not for a group) -
	 * what changed is that deciding one candidate no longer hides the other thirty-nine.
	 *
	 * Three things ride along, per the issue:
	 *  - A candidate with no diff yet (`awaitingDiff`, reused from #468 rather than
	 *    re-derived) renders as `AwaitingDiffCard` instead of `ProposalDiffCard` - says so,
	 *    offers the price, never an empty diff with nothing to explain it.
	 *  - A candidate with an outcome already collapses to `SettledProposalRow`, one line
	 *    carrying its outcome, so forty pending survives the scroll rather than forty full
	 *    diffs stacked on top of each other.
	 *  - Each `group` collapses independently (closed by default once nothing in it is
	 *    still pending), so a plan or an import job nobody is actively reviewing does not
	 *    have to stay expanded to be present.
	 *
	 * Owns exactly one thing beyond display: which candidate is focused and the toast/undo
	 * window. Every write goes through the page's own form actions (`?/accept`, `?/reject`,
	 * `?/setRejectReason`, `?/undo`), submitted programmatically and enhanced to patch
	 * local state instead of the default full-page invalidate - the queue has to feel
	 * instant. `groups` is read once, at mount, exactly like the single `candidates` list
	 * this replaced: a caller that wants a fresh server read on some other change (D4's
	 * filter switch) still remounts via its own `{#key}`.
	 */
	import { flushSync } from 'svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { InlineLink } from '$lib/components/ui/link';
	import { KeyHint, type KeyHintPair } from '$lib/components/ui/key-hint';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ProposalDiffCard from './ProposalDiffCard.svelte';
	import AwaitingDiffCard from './AwaitingDiffCard.svelte';
	import SettledProposalRow from './SettledProposalRow.svelte';
	import RejectChips from './RejectChips.svelte';

	let {
		groups,
		universeSlug,
		/** #468's reused price for any group's awaiting-diff candidates - one number for
		 * the whole queue, since `propagate.diff` prices the same regardless of which plan
		 * a candidate is waiting in. Unused (and harmless) where nothing here awaits a
		 * diff, which is every import candidate: import proposals arrive already diffed. */
		diffPriceCredits = 0,
		/** D4's chip filter, applied by the caller before candidates ever reach this
		 * component - kept as a prop only so the summary line can say "(Characters
		 * shown)" against the filtered set. Already a display label (the caller's own
		 * bucket `label`, already localized), never a raw type key. */
		filterType = null,
		locale
	}: {
		groups: ProposalGroupView[];
		universeSlug: string;
		diffPriceCredits?: number;
		filterType?: string | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).proposals.queue);
	let tInbox = $derived(messages(locale).proposals.inbox);

	type QueueItem = QueueCandidateView & { groupId: string };

	let items = $state<QueueItem[]>(
		groups.flatMap((g) => g.candidates.map((c) => ({ ...c, groupId: g.id })))
	);
	/** Open by default only where there is still something to decide - a group that
	 * arrives already fully settled (every candidate accepted or rejected before this
	 * page loaded) starts closed, since there is nothing there to act on. Never
	 * recomputed after mount: a group the reader closes stays closed even once its last
	 * candidate is decided, and one they leave open stays open, because a queue that
	 * folds itself away mid-review is worse than one that does not fold at all. */
	let openGroups = $state<Record<string, boolean>>(
		Object.fromEntries(groups.map((g) => [g.id, g.candidates.some((c) => c.outcome === 'pending')]))
	);
	let currentId = $state<string | null>(
		items.find((c) => c.outcome === 'pending' && !c.awaitingDiff)?.id ?? items[0]?.id ?? null
	);
	let rejectChipsFor = $state<string | null>(null);
	let toast = $state<{ text: string; undoId: string | null } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	let pendingCount = $derived(items.filter((c) => c.outcome === 'pending').length);
	let acceptedCount = $derived(items.filter((c) => c.outcome === 'accepted').length);
	let rejectedCount = $derived(items.filter((c) => c.outcome === 'rejected').length);
	// Issue #613: a candidate settled without anybody deciding it, which for an import
	// means a relation whose entry was rejected. It is neither pending nor accepted nor
	// rejected, so before this the header's three numbers simply did not add up to the rows
	// on screen, and the two missing ones were exactly the ones this issue made reachable.
	let supersededCount = $derived(items.filter((c) => c.outcome === 'superseded').length);
	let itemsByGroup = $derived(
		groups.map((group) => ({
			group,
			list: items.filter((it) => it.groupId === group.id)
		}))
	);

	function groupPendingCount(list: QueueItem[]): number {
		return list.filter((c) => c.outcome === 'pending').length;
	}

	// T5 (round fifteen), issue #432: one key beside one verb, in the shared `KeyHint`
	// shape. Issue #473: `j`/`k` used to share one verb ("move"), which named neither
	// direction - they are `next`/`previous` now, matching `move(1)`/`move(-1)` below.
	let keyPairs = $derived<KeyHintPair[]>([
		{ key: 'j', label: t.keyboardNext },
		{ key: 'k', label: t.keyboardPrevious },
		{ key: 'a', label: t.keyboardAccept },
		{ key: 'r', label: t.keyboardReject },
		{ key: 'u', label: t.keyboardUndo }
	]);

	// Hidden form fields, reused for every action - one form per action name, its
	// proposalId/reason set right before a programmatic submit.
	let acceptForm: HTMLFormElement;
	let acceptProposalId = $state('');
	let rejectForm: HTMLFormElement;
	let rejectProposalId = $state('');
	let reasonForm: HTMLFormElement;
	let reasonProposalId = $state('');
	let reasonValue = $state('');
	let undoForm: HTMLFormElement;
	let undoProposalId = $state('');
	let widenAndAcceptForm: HTMLFormElement;
	let widenAndAcceptProposalId = $state('');

	function showToast(text: string, undoId: string | null): void {
		clearTimeout(toastTimer);
		toast = { text, undoId };
		toastTimer = setTimeout(() => (toast = null), 6000);
	}

	/** An "actionable" candidate is pending and already has a diff to decide on - the
	 * set `j`/`k` land on when auto-advancing after a decision, and the set `a`/`r`
	 * are allowed to touch. Manual `j`/`k` (a click on nothing, or a keypress) may still
	 * move across a settled or awaiting-diff row for reading - only the auto-advance and
	 * the accept/reject guards restrict themselves to this set. */
	function isActionable(item: QueueItem | undefined): item is QueueItem {
		return !!item && item.outcome === 'pending' && !item.awaitingDiff;
	}

	function nextPendingAfter(id: string | null): string | null {
		const startIndex = id ? items.findIndex((c) => c.id === id) : -1;
		for (let offset = 1; offset <= items.length; offset++) {
			const candidate = items[(startIndex + offset + items.length) % items.length];
			if (isActionable(candidate)) return candidate.id;
		}
		return id;
	}

	function move(delta: 1 | -1): void {
		if (items.length === 0) return;
		const currentIndex = currentId ? items.findIndex((c) => c.id === currentId) : -1;
		const idx = currentIndex < 0 ? 0 : (currentIndex + delta + items.length) % items.length;
		const next = items[idx];
		if (!next) return;
		currentId = next.id;
		openGroups[next.groupId] = true;
	}

	function accept(id: string | null): void {
		const target = id ? items.find((c) => c.id === id) : undefined;
		if (!isActionable(target)) return;
		currentId = target.id;
		flushSync(() => {
			acceptProposalId = target.id;
		});
		acceptForm.requestSubmit();
	}

	/** Issue #628: the button that names both effects - widen the type, then accept the
	 * relation - which is the GM's consent to both, in that order. Same shape as `accept`
	 * above, and it posts nothing but the proposal id on purpose: the server re-reads which
	 * widening this link needs off its own admission check, so the pair the arrays grow by
	 * can never be something a request named. `item.notAdmitted` is read here only to know
	 * the button applies at all. */
	function widenAndAccept(id: string | null): void {
		const target = id ? items.find((c) => c.id === id) : undefined;
		if (!isActionable(target) || !target.notAdmitted) return;
		currentId = target.id;
		flushSync(() => {
			widenAndAcceptProposalId = target.id;
		});
		widenAndAcceptForm.requestSubmit();
	}

	function reject(id: string | null): void {
		const target = id ? items.find((c) => c.id === id) : undefined;
		if (!isActionable(target)) return;
		currentId = target.id;
		flushSync(() => {
			rejectProposalId = target.id;
		});
		rejectForm.requestSubmit();
	}

	function pickReason(reason: string): void {
		if (!rejectChipsFor) return;
		const id = rejectChipsFor;
		flushSync(() => {
			reasonProposalId = id;
			reasonValue = reason;
		});
		reasonForm.requestSubmit();
		rejectChipsFor = null;
	}

	function undo(id: string | null): void {
		if (!id) return;
		flushSync(() => {
			undoProposalId = id;
		});
		undoForm.requestSubmit();
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
		if (event.key === 'j') {
			event.preventDefault();
			move(1);
		} else if (event.key === 'k') {
			event.preventDefault();
			move(-1);
		} else if (event.key === 'a') {
			event.preventDefault();
			accept(currentId);
		} else if (event.key === 'r') {
			event.preventDefault();
			reject(currentId);
		} else if (event.key === 'u') {
			event.preventDefault();
			undo(toast?.undoId ?? null);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<form
	bind:this={acceptForm}
	method="POST"
	action="?/accept"
	class="hidden"
	use:enhance={() => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data) {
				const id = result.data.id as string;
				const item = items.find((c) => c.id === id);
				if (item) item.outcome = 'accepted';
				showToast(t.acceptedToast(item?.targetName ?? null), id);
				currentId = nextPendingAfter(id);
			} else if (result.type === 'failure') {
				// Issue #628: the real endpoint pair genuinely is not admitted - a route
				// forward on the card (the widen-and-accept button, or the shipped
				// explanation) beats a generic red toast with nowhere to go next.
				const notAdmitted = result.data?.notAdmitted as
					(DiffCandidateNotAdmittedView & { proposalId: string }) | undefined;
				const item = notAdmitted ? items.find((c) => c.id === notAdmitted.proposalId) : undefined;
				if (notAdmitted && item) {
					item.notAdmitted = {
						relationTypeId: notAdmitted.relationTypeId,
						typeLabel: notAdmitted.typeLabel,
						typeKey: notAdmitted.typeKey,
						fromType: notAdmitted.fromType,
						toType: notAdmitted.toType,
						addFrom: notAdmitted.addFrom,
						addTo: notAdmitted.addTo,
						shipped: notAdmitted.shipped
					};
					currentId = item.id;
				} else {
					showToast(t.acceptFailedToast, null);
				}
			}
		};
	}}
>
	<input type="hidden" name="proposalId" value={acceptProposalId} />
</form>

<form
	bind:this={widenAndAcceptForm}
	method="POST"
	action="?/widenAndAccept"
	class="hidden"
	use:enhance={() => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data) {
				const id = result.data.id as string;
				const item = items.find((c) => c.id === id);
				if (item) item.outcome = 'accepted';
				showToast(t.acceptedToast(item?.targetName ?? null), id);
				currentId = nextPendingAfter(id);
			} else if (result.type === 'failure') {
				showToast(t.acceptFailedToast, null);
			}
		};
	}}
>
	<input type="hidden" name="proposalId" value={widenAndAcceptProposalId} />
</form>

<form
	bind:this={rejectForm}
	method="POST"
	action="?/reject"
	class="hidden"
	use:enhance={() => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data) {
				const id = result.data.id as string;
				const item = items.find((c) => c.id === id);
				if (item) item.outcome = 'rejected';
				rejectChipsFor = id;
				clearTimeout(toastTimer);
				toast = null;
				toastTimer = setTimeout(() => (rejectChipsFor = null), 6000);
				currentId = nextPendingAfter(id);
			}
		};
	}}
>
	<input type="hidden" name="proposalId" value={rejectProposalId} />
</form>

<form
	bind:this={reasonForm}
	method="POST"
	action="?/setRejectReason"
	class="hidden"
	use:enhance={() => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data) {
				const id = result.data.id as string;
				const reason = result.data.reason as string;
				const item = items.find((c) => c.id === id);
				if (item) item.rejectReason = reason;
			}
		};
	}}
>
	<input type="hidden" name="proposalId" value={reasonProposalId} />
	<input type="hidden" name="reason" value={reasonValue} />
</form>

<form
	bind:this={undoForm}
	method="POST"
	action="?/undo"
	class="hidden"
	use:enhance={() => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data) {
				const id = result.data.id as string;
				const item = items.find((c) => c.id === id);
				if (item) item.outcome = 'pending';
				toast = null;
				currentId = id;
			} else if (result.type === 'failure') {
				showToast(t.undoFailedToast, null);
			}
		};
	}}
>
	<input type="hidden" name="proposalId" value={undoProposalId} />
</form>

<div class="qwrap flex flex-col gap-4">
	<div class="flex items-center justify-between text-meta text-muted">
		<span>
			{tInbox.pendingLabel(pendingCount)}
			{#if filterType}&middot; {t.filterShown(filterType)}{/if}
		</span>
		<span>
			<b class="text-ok">{acceptedCount}</b>{t.acceptedSuffix(acceptedCount)} &middot;
			<b class="text-danger">{rejectedCount}</b>{t.rejectedSuffix(rejectedCount)}
			{#if supersededCount > 0}
				&middot; <b>{supersededCount}</b>{t.supersededSuffix(supersededCount)}
			{/if}
		</span>
	</div>

	{#if items.length === 0}
		<EmptyState kind="settled" message={t.empty} />
	{:else}
		{#each itemsByGroup as { group, list } (group.id)}
			<!-- Issue #526: `group.heading`, when a route sets one, is the missing h2
			     between the page's own h1 and each card's own title - previously a plain
			     `<span>`, so a screen reader walking the queue jumped straight from the
			     page heading to a run of h3s. `cardHeadingLevel` is what each card below
			     renders at: h3 under this h2 when the group has one, h2 directly under the
			     page's own h1 when it does not (the plan and import-job routes, whose one
			     implicit group renders no heading of its own - #498's doc comment on
			     `ProposalGroupView.heading`). The button nests inside the `h2` rather than
			     around it, the WAI-ARIA accordion pattern: a heading's content model is
			     phrasing content, which a `<button>` satisfies, so this is valid markup
			     that also keeps the whole row's own click target unchanged. -->
			{@const cardHeadingLevel = group.heading ? 3 : 2}
			<section>
				{#if group.heading}
					<div class="flex items-center justify-between gap-3 border-t border-line py-2">
						<h2 class="min-w-0 flex-1">
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 text-left font-normal"
								aria-expanded={openGroups[group.id] ?? false}
								aria-controls={`qgroup-${group.id}`}
								onclick={() => (openGroups[group.id] = !openGroups[group.id])}
							>
								<span class="min-w-0">
									<span class="block truncate text-title font-semibold text-ink">
										{group.heading}
									</span>
									{#if group.meta}
										<span class="block text-meta text-muted">{group.meta}</span>
									{/if}
								</span>
								<span class="flex flex-none items-center gap-2 text-meta text-muted">
									{tInbox.pendingLabel(groupPendingCount(list))}
									<ChevronDownIcon class={openGroups[group.id] ? 'size-4' : 'size-4 -rotate-90'} />
								</span>
							</button>
						</h2>
						{#if group.importJobId}
							<InlineLink
								href={resolve(`/w/${universeSlug}/import/${group.importJobId}/review`)}
								class="flex-none text-label"
							>
								{tInbox.openImportReview}
							</InlineLink>
						{/if}
					</div>
				{/if}

				{#if !group.heading || openGroups[group.id]}
					<div id={`qgroup-${group.id}`} class="flex flex-col gap-3" class:pt-3={!!group.heading}>
						{#each list as item (item.id)}
							<div
								class="border-l-2 pl-3"
								class:border-accent={item.id === currentId}
								class:border-transparent={item.id !== currentId}
							>
								{#if item.outcome !== 'pending'}
									<SettledProposalRow
										candidate={item}
										{universeSlug}
										{locale}
										onUndo={item.outcome === 'accepted' ? () => undo(item.id) : undefined}
									/>
								{:else if item.awaitingDiff}
									<AwaitingDiffCard
										candidate={item}
										{universeSlug}
										{diffPriceCredits}
										{locale}
										headingLevel={cardHeadingLevel}
									/>
								{:else}
									<ProposalDiffCard
										candidate={item}
										{universeSlug}
										showRejectChips={rejectChipsFor === item.id}
										{locale}
										headingLevel={cardHeadingLevel}
										onAccept={() => accept(item.id)}
										onReject={() => reject(item.id)}
										onRejectReason={pickReason}
										onWidenAndAccept={() => widenAndAccept(item.id)}
									/>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	{/if}

	<!-- Issue #148 (I10 = B): bare keys don't exist on a phone, so `KeyHint` hides
	     itself below `sm` - every card's own Accept/Reject buttons (#148) are the
	     primary interaction there instead. T5 (round fifteen), issue #432: one shared
	     component rather than this file's own kbd markup. -->
	<KeyHint pairs={keyPairs} class="qkeys" />

	<!-- #367 (Q6): "a proposal being accepted or rejected" is one of the five cases the
	     decision names, and this strip plus the reject reasons below it are where that
	     lands in this component. Both arrive on `duration-move`; neither animates away,
	     because `u` has to undo an accept the instant it is pressed and the six-second
	     timer is what ends the strip, not a fade. -->
	{#if toast}
		<div
			class="qtoast flex animate-in items-center justify-between gap-3 rounded-md bg-ink px-3 py-2 text-label text-panel duration-move ease-arrive fade-in-0 slide-in-from-bottom-1"
		>
			<span>{toast.text}</span>
			{#if toast.undoId}
				<button type="button" class="underline" onclick={() => undo(toast?.undoId ?? null)}>
					{t.undo}
				</button>
			{/if}
		</div>
	{/if}

	{#if rejectChipsFor}
		<div
			class="animate-in rounded-md border border-line bg-panel-2 px-3 py-2 duration-move ease-arrive fade-in-0 slide-in-from-bottom-1"
		>
			<RejectChips onPick={pickReason} {locale} />
		</div>
	{/if}
</div>
