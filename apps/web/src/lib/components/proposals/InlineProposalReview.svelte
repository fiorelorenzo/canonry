<script lang="ts">
	/**
	 * Issue #345: C6's review queue, rendered where the proposal was born instead of on a
	 * screen you navigate to. Same card (`ProposalDiffCard`), same C4 diff, same C5 evidence
	 * popover, same C7 reject chips, same `j k a r u` and the same always-visible buttons, so
	 * this is one review surface appearing in more than one place, not a second one competing
	 * with the inbox (C2). The inbox and the plan queue are untouched and stay the answer when
	 * there are twelve of these; what changes is that dealing with one no longer costs a
	 * navigation and the loss of everything you were reading.
	 *
	 * Guardrail 1, three ways, none of them optional:
	 *  - one card at a time, and the only two decisions on it are for that one proposal. There
	 *    is no control here that touches a proposal the GM is not reading, so there is nothing
	 *    to grow an "accept all" out of.
	 *  - the caller passes candidates for one entry (the entry page) or one drafted proposal
	 *    (Ask). Accepting therefore cannot reach a second entry even by accident.
	 *  - every write goes through `decideProposal`, whose URL carries exactly one proposal id.
	 *
	 * The keyboard is bound to this region rather than to the window, unlike `ProposalQueue`,
	 * and that difference is deliberate: the plan page is nothing but a queue, while an entry
	 * is a reading surface with its own controls, and a bare `a` that accepts canon while
	 * somebody is reading prose is not a shortcut, it is a trap. The region takes focus when
	 * it appears (`focusRegion`, called by the entry page when a draft lands), so keyboard
	 * users reach the same three keystrokes without a single Tab.
	 */
	import { untrack } from 'svelte';
	import { messages, type Locale } from '$lib/i18n';
	import { KeyHint, type KeyHintPair } from '$lib/components/ui/key-hint';
	import ProposalDiffCard, { type DiffCandidateView } from './ProposalDiffCard.svelte';
	import RejectChips from './RejectChips.svelte';
	import { decideProposal, InlineReviewError } from '$lib/proposals/inline';

	let {
		candidates,
		universeSlug,
		locale,
		onDecided
	}: {
		/** Already enriched server-side, exactly as the queue receives them. Newest last:
		 * a fresh draft becomes the focused card. */
		candidates: DiffCandidateView[];
		universeSlug: string;
		locale: Locale;
		/** Fired after a decision the surrounding page has to reflect: on the entry page an
		 * accepted `update` changes the prose above this region, so the page re-runs its own
		 * load rather than this component patching canon text it does not own. */
		onDecided?: (action: 'accept' | 'reject' | 'undo') => void;
	} = $props();

	let t = $derived(messages(locale).proposals);

	// T5 (round fifteen), issue #432: the same five pairs `ProposalQueue` builds, off
	// `queue`'s own verbs rather than the joined phrase `inline.keys` used to compose -
	// C6's vocabulary is one vocabulary, and now it is stated once. Issue #473: `j`/`k`
	// are `next`/`previous`, matching `move(1)`/`move(-1)` below.
	let keyPairs = $derived<KeyHintPair[]>([
		{ key: 'j', label: t.queue.keyboardNext },
		{ key: 'k', label: t.queue.keyboardPrevious },
		{ key: 'a', label: t.queue.keyboardAccept },
		{ key: 'r', label: t.queue.keyboardReject },
		{ key: 'u', label: t.queue.keyboardUndo }
	]);

	// The initial value on purpose; the `$effect` below is what folds in later arrivals,
	// because a card decided in this session has to keep its outcome across the page's own
	// reload rather than being reset by it.
	// svelte-ignore state_referenced_locally
	let items = $state<DiffCandidateView[]>(candidates.map((c) => ({ ...c })));
	// svelte-ignore state_referenced_locally
	let currentId = $state<string | null>(candidates.at(-1)?.id ?? null);
	let rejectChipsFor = $state<string | null>(null);
	let busy = $state(false);
	let failure = $state<string | null>(null);
	let region = $state<HTMLElement | null>(null);

	// New arrivals (a second generation on the same entry, a re-run of the page's load) join
	// the list; a card already decided in this session keeps the outcome it has, so its undo
	// window survives the `load` that an accept triggers. `untrack` on the read: this effect
	// writes `items`, and re-reading it reactively would schedule itself forever.
	$effect(() => {
		const known = new Set(untrack(() => items).map((item) => item.id));
		const arrived = candidates.filter((candidate) => !known.has(candidate.id));
		if (arrived.length === 0) return;
		items = [...untrack(() => items), ...arrived.map((c) => ({ ...c }))];
		currentId = arrived.at(-1)?.id ?? currentId;
	});

	let current = $derived(items.find((item) => item.id === currentId) ?? null);
	let currentIndex = $derived(items.findIndex((item) => item.id === currentId));
	let pendingCount = $derived(items.filter((item) => item.outcome === 'pending').length);

	export function focusRegion(): void {
		region?.focus();
	}

	function move(delta: 1 | -1): void {
		if (items.length === 0) return;
		const index = currentIndex < 0 ? 0 : (currentIndex + delta + items.length) % items.length;
		currentId = items[index]?.id ?? currentId;
	}

	function nextPendingAfter(id: string): string {
		const from = items.findIndex((item) => item.id === id);
		for (let offset = 1; offset <= items.length; offset++) {
			const candidate = items[(from + offset + items.length) % items.length];
			if (candidate && candidate.outcome === 'pending') return candidate.id;
		}
		return id;
	}

	async function decide(action: 'accept' | 'reject' | 'undo'): Promise<void> {
		const target = current;
		if (!target || busy) return;
		if (action === 'undo' ? target.outcome !== 'accepted' : target.outcome !== 'pending') return;
		busy = true;
		failure = null;
		try {
			await decideProposal(universeSlug, target.id, action);
			const item = items.find((candidate) => candidate.id === target.id);
			if (item) item.outcome = action === 'undo' ? 'pending' : `${action}ed`;
			rejectChipsFor = action === 'reject' ? target.id : null;
			if (action !== 'undo') currentId = nextPendingAfter(target.id);
			onDecided?.(action);
		} catch (err) {
			failure = err instanceof InlineReviewError ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function pickReason(reason: string): Promise<void> {
		const id = rejectChipsFor;
		if (!id) return;
		rejectChipsFor = null;
		try {
			await decideProposal(universeSlug, id, 'reason', reason);
			const item = items.find((candidate) => candidate.id === id);
			if (item) item.rejectReason = reason;
		} catch (err) {
			failure = err instanceof InlineReviewError ? err.message : String(err);
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'j') {
			event.preventDefault();
			move(1);
		} else if (event.key === 'k') {
			event.preventDefault();
			move(-1);
		} else if (event.key === 'a') {
			event.preventDefault();
			void decide('accept');
		} else if (event.key === 'r') {
			event.preventDefault();
			void decide('reject');
		} else if (event.key === 'u') {
			event.preventDefault();
			void decide('undo');
		}
	}
</script>

<!-- Furniture, so neutral: round eleven's P2 takes the copilot's hue off everything that is
     not a word a model wrote. The marking inside the card and the diff's own tint are
     `ProposalDiffCard`'s, and stay its business. -->
<!-- The keydown listener belongs on the region and not on the window, which is the whole
     point: see this component's own header. It is focusable, it is labelled, and it
     announces its key vocabulary, so the keystrokes are reachable and discoverable rather
     than ambient. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	bind:this={region}
	tabindex="-1"
	onkeydown={onKeydown}
	aria-label={t.inline.regionLabel}
	aria-busy={busy}
	class="mb-6 border-t border-line pt-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
>
	<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
		<span>
			{pendingCount > 0 ? t.inline.heading(pendingCount) : t.inline.headingSettled}
			{#if items.length > 1}
				<span class="ml-1 font-mono">{t.inline.position(currentIndex + 1, items.length)}</span>
			{/if}
		</span>
		<!-- C6's vocabulary named where it applies. `KeyHint` hides itself below `sm` for
		     the same reason `ProposalQueue` does (#148): a phone has no bare keys, and the
		     card's own buttons are the primary interaction there. T5 (round fifteen),
		     issue #432. -->
		<KeyHint pairs={keyPairs} />
	</div>

	{#if items.length > 1}
		<div class="mb-2 flex flex-wrap gap-1">
			{#each items as item, index (item.id)}
				<button
					type="button"
					class="flex min-h-9 min-w-9 items-center justify-center rounded-md border px-2.5 py-1.5 font-mono text-label"
					class:border-accent={item.id === currentId}
					class:bg-accent-bg={item.id === currentId}
					class:border-line={item.id !== currentId}
					class:text-ok={item.outcome === 'accepted'}
					class:text-danger={item.outcome === 'rejected'}
					onclick={() => (currentId = item.id)}
				>
					{index + 1}
				</button>
			{/each}
		</div>
	{/if}

	{#if current}
		<ProposalDiffCard
			candidate={current}
			{universeSlug}
			showRejectChips={false}
			{locale}
			onAccept={() => void decide('accept')}
			onReject={() => void decide('reject')}
			onRejectReason={(reason) => void pickReason(reason)}
			onUndo={() => void decide('undo')}
		/>
	{/if}

	{#if current?.outcome === 'accepted'}
		<p class="mt-2 mb-0 text-xs text-ok">{t.inline.acceptedNote}</p>
	{/if}

	{#if rejectChipsFor}
		<div class="mt-2 rounded-md border border-line bg-panel px-3 py-2">
			<RejectChips onPick={(reason) => void pickReason(reason)} {locale} />
		</div>
	{/if}

	{#if failure}
		<p class="mt-2 mb-0 rounded-md bg-danger-bg px-2 py-1 text-xs text-danger">
			{t.inline.failed(failure)}
		</p>
	{/if}
</section>
