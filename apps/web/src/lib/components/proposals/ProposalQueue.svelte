<script lang="ts">
	/**
	 * C6 = B: a focused keyboard queue. j/k move, a accepts, r rejects, u undoes an accept -
	 * bare keys inside this focused surface (G3), with A's buttons always visible on the
	 * card so a mouse-only GM loses nothing. The small pill list above the card is what lets
	 * a GM jump around instead of only stepping forward.
	 *
	 * Owns exactly one thing beyond display: which candidate is focused and the toast/undo
	 * window. Every write goes through the page's own form actions (`?/accept`, `?/reject`,
	 * `?/setRejectReason`, `?/undo`), submitted programmatically and enhanced to patch local
	 * state instead of the default full-page invalidate - the queue has to feel instant.
	 */
	import { flushSync } from 'svelte';
	import { enhance } from '$app/forms';
	import { messages, type Locale } from '$lib/i18n';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { KeyHint, type KeyHintPair } from '$lib/components/ui/key-hint';
	import ProposalDiffCard, { type DiffCandidateView } from './ProposalDiffCard.svelte';
	import RejectChips from './RejectChips.svelte';

	let {
		candidates,
		universeSlug,
		filterType = null,
		locale
	}: {
		candidates: DiffCandidateView[];
		universeSlug: string;
		/** D4's chip filter, applied by the caller before candidates ever reach this
		 * component - kept as a prop only so the position counter can say "N of M shown"
		 * against the filtered set rather than the whole queue. Already a display label
		 * (the caller's own bucket `label`, already localized), never a raw type key. */
		filterType?: string | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).proposals.queue);

	let items = $state(candidates.map((c) => ({ ...c })));
	let currentId = $state<string | null>(
		items.find((c) => c.outcome === 'pending')?.id ?? items[0]?.id ?? null
	);
	let rejectChipsFor = $state<string | null>(null);
	let toast = $state<{ text: string; undoId: string | null } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	let current = $derived(items.find((c) => c.id === currentId) ?? null);
	let currentIndex = $derived(items.findIndex((c) => c.id === currentId));
	let acceptedCount = $derived(items.filter((c) => c.outcome === 'accepted').length);
	let rejectedCount = $derived(items.filter((c) => c.outcome === 'rejected').length);
	let posLabel = $derived(t.position(items.length));

	// T5 (round fifteen), issue #432: one key beside one verb, in the shared `KeyHint`
	// shape. `j`/`k` share one verb (move), so they are two pairs rather than one pair
	// carrying two keys.
	let keyPairs = $derived<KeyHintPair[]>([
		{ key: 'j', label: t.keyboardMove },
		{ key: 'k', label: t.keyboardMove },
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

	function showToast(text: string, undoId: string | null): void {
		clearTimeout(toastTimer);
		toast = { text, undoId };
		toastTimer = setTimeout(() => (toast = null), 6000);
	}

	function nextPendingAfter(id: string | null): string | null {
		const startIndex = id ? items.findIndex((c) => c.id === id) : -1;
		for (let offset = 1; offset <= items.length; offset++) {
			const candidate = items[(startIndex + offset + items.length) % items.length];
			if (candidate && candidate.outcome === 'pending') return candidate.id;
		}
		return id;
	}

	function move(delta: 1 | -1): void {
		if (items.length === 0) return;
		const idx = currentIndex < 0 ? 0 : (currentIndex + delta + items.length) % items.length;
		currentId = items[idx]?.id ?? currentId;
	}

	function accept(): void {
		if (!current || current.outcome !== 'pending') return;
		flushSync(() => {
			acceptProposalId = current!.id;
		});
		acceptForm.requestSubmit();
	}

	function reject(): void {
		if (!current || current.outcome !== 'pending') return;
		flushSync(() => {
			rejectProposalId = current!.id;
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

	function undo(): void {
		if (!toast?.undoId) return;
		const id = toast.undoId;
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
			accept();
		} else if (event.key === 'r') {
			event.preventDefault();
			reject();
		} else if (event.key === 'u') {
			event.preventDefault();
			undo();
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
				showToast(t.acceptedToast(current?.targetName ?? null), id);
				currentId = nextPendingAfter(id);
			}
		};
	}}
>
	<input type="hidden" name="proposalId" value={acceptProposalId} />
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

<div class="qwrap flex flex-col gap-3">
	<div class="qlist flex flex-wrap gap-1">
		{#each items as item, i (item.id)}
			<button
				type="button"
				class="qrow flex min-h-9 min-w-9 items-center justify-center rounded-md border px-2.5 py-1.5 font-mono text-[11px]"
				class:border-accent={item.id === currentId}
				class:bg-accent-bg={item.id === currentId}
				class:border-line={item.id !== currentId}
				class:text-ok={item.outcome === 'accepted'}
				class:text-danger={item.outcome === 'rejected'}
				onclick={() => (currentId = item.id)}
			>
				{i + 1}
			</button>
		{/each}
	</div>

	<div class="qhead flex items-center justify-between text-xs text-muted">
		<span>
			{posLabel.prefix}<b class="text-ink">{currentIndex + 1}</b>{posLabel.suffix}
			{#if filterType}{t.filterShown(filterType)}{/if}
		</span>
		<span
			><b class="text-ok">{acceptedCount}</b>{t.acceptedSuffix(acceptedCount)} &middot;
			<b class="text-danger">{rejectedCount}</b>{t.rejectedSuffix(rejectedCount)}</span
		>
	</div>

	{#if current}
		<ProposalDiffCard
			candidate={current}
			{universeSlug}
			showRejectChips={false}
			{locale}
			onAccept={accept}
			onReject={reject}
			onRejectReason={pickReason}
			onUndo={() => {
				if (!current) return;
				flushSync(() => {
					undoProposalId = current!.id;
				});
				undoForm.requestSubmit();
			}}
		/>
	{:else}
		<EmptyState kind="settled" message={t.empty} />
	{/if}

	<!-- Issue #148 (I10 = B): bare keys don't exist on a phone, so `KeyHint` hides
	     itself below `sm` - the card's own Accept/Reject buttons (#148) are the
	     primary interaction there instead. T5 (round fifteen), issue #432: one shared
	     component rather than this file's own kbd markup. -->
	<KeyHint pairs={keyPairs} class="qkeys" />

	<!-- #367 (Q6): "a proposal being accepted or rejected" is one of the five cases the
	     decision names, and this strip plus the reject reasons below it are where that
	     lands in this component. Both arrive on `duration-move`; neither animates away,
	     because `u` has to undo an accept the instant it is pressed and the six-second
	     timer is what ends the strip, not a fade. Nothing here touches the card: the diff
	     itself is #362's, and a card that eased in under a keyboard queue would fight
	     `j`/`k` anyway. -->
	{#if toast}
		<div
			class="qtoast flex animate-in items-center justify-between gap-3 rounded-md bg-ink px-3 py-2 text-xs text-panel duration-move ease-arrive fade-in-0 slide-in-from-bottom-1"
		>
			<span>{toast.text}</span>
			{#if toast.undoId}
				<button type="button" class="underline" onclick={undo}>{t.undo}</button>
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
