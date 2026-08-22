<script lang="ts">
	/**
	 * Issue #529, round eighteen: W1 = A for the board (`sm`, 640px, and up) and B's deck
	 * for the phone, "not a compromise: it is the same content at the size a phone beside
	 * a screen can actually be glanced at." One card fills the width - the place first
	 * (so a GM sees where they are before who is there), then every pinned neighbour -
	 * and a thumbnail strip below jumps between them. `+page.svelte` is the one that
	 * decides the breakpoint (`<div class="sm:hidden">` wraps this component), so this
	 * root carries no breakpoint class of its own: a component should not duplicate a
	 * cutoff its mount point already owns, with the two free to drift apart.
	 *
	 * `PinCard.warm` and `hasPendingProposal` are both mid-migration in #529's own
	 * worktree (`table/_server/pin-cards.ts`, `types.ts`) as this was written: `warm`
	 * moves from a status/relative-time pair to `{status:'ready', text, stale} |
	 * {status:'missing'}` so a stale brief still renders its text instead of dropping
	 * it, and `hasPendingProposal` is new. `DeckPin` below extends `PinCard` with
	 * `Omit` + an intersection rather than importing that shape directly, so this file
	 * compiles and renders correctly whichever side of that migration `types.ts`
	 * happens to be on - it does not freeze a snapshot of a file this component does
	 * not own.
	 *
	 * Wording is shared rather than reinvented: "why this pin is here" reuses
	 * `pinnedCards`'s own two phrasings so the board and the deck describe the same
	 * pin identically, and the note form reuses `quickNoteForm`'s disclaimer and
	 * button copy for the same reason guardrail 1 gives everywhere else a note is
	 * taken at the table - it is never applied directly, and every surface that takes
	 * one says so in the same words.
	 */
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import type { PinCard } from './types';

	type DeckWarm = { status: 'ready'; text: string | null; stale: boolean } | { status: 'missing' };
	type DeckPin = Omit<PinCard, 'warm'> & { warm: DeckWarm; hasPendingProposal?: boolean };

	let {
		pins,
		placeName,
		placeBrief,
		placeContext,
		canReveal,
		locale,
		onNote,
		onReveal
	}: {
		pins: DeckPin[];
		placeName: string;
		placeBrief: string | null;
		/** The place's own `context_pack` text, same shape as `placeBrief` - shown only
		 * on the place card (card 0), never on a pin's. */
		placeContext: string | null;
		/** Mirrors the board's own action bar: reveal needs a declared session (G7), so
		 * every card's reveal button is disabled the same way with none running. */
		canReveal: boolean;
		locale: Locale;
		onNote: (text: string, pinId: string) => void;
		onReveal: (pinId: string) => void;
	} = $props();

	const t = $derived(messages(locale).table.deck);
	const tHome = $derived(messages(locale).table.home);
	const tPinned = $derived(messages(locale).table.pinnedCards);
	const tNote = $derived(messages(locale).table.quickNoteForm);
	const tDock = $derived(messages(locale).table.quickActionDock);

	// The universe slug is not part of the fixed contract (only `onNote`/`onReveal`
	// are), but "open the entry" is a real navigation, not a callback, and this
	// component only ever mounts under `/w/[universe]/table` - reading it off the
	// route rather than adding a prop the contract does not have.
	const universeSlug = $derived(page.params.universe ?? '');

	type Card = { kind: 'place' } | { kind: 'pin'; pin: DeckPin };

	const cards = $derived<Card[]>([
		{ kind: 'place' },
		...pins.map((pin) => ({ kind: 'pin' as const, pin }))
	]);

	let index = $state(0);
	let direction = $state<1 | -1>(1);

	// A pin leaving the array (a future session ending, say) should not leave the deck
	// pointed past its own end.
	$effect(() => {
		if (index > cards.length - 1) index = Math.max(0, cards.length - 1);
	});

	const current = $derived(cards[index] ?? { kind: 'place' as const });
	const currentName = $derived(current.kind === 'place' ? placeName : current.pin.name);
	const cardKey = $derived(current.kind === 'place' ? 'place' : current.pin.entityId);

	let noteOpen = $state(false);
	let noteText = $state('');
	let notePending = $state(false);
	let revealPending = $state<string | null>(null);
	const revealed = new SvelteSet<string>();

	function goTo(rawTarget: number): void {
		if (cards.length === 0) return;
		direction = rawTarget > index ? 1 : rawTarget < index ? -1 : direction;
		index = ((rawTarget % cards.length) + cards.length) % cards.length;
		noteOpen = false;
		noteText = '';
	}

	function next(): void {
		goTo(index + 1);
	}

	function prev(): void {
		goTo(index - 1);
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			next();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			prev();
		}
	}

	let pointerStartX: number | null = null;
	let pointerStartY: number | null = null;
	const SWIPE_THRESHOLD_PX = 40;

	function onPointerDown(event: PointerEvent): void {
		pointerStartX = event.clientX;
		pointerStartY = event.clientY;
	}

	function onPointerUp(event: PointerEvent): void {
		if (pointerStartX === null || pointerStartY === null) return;
		const dx = event.clientX - pointerStartX;
		const dy = event.clientY - pointerStartY;
		pointerStartX = null;
		pointerStartY = null;
		if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
		if (dx < 0) next();
		else prev();
	}

	function onPointerCancel(): void {
		pointerStartX = null;
		pointerStartY = null;
	}

	function initialsOf(name: string): string {
		const parts = name.split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
		return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
	}

	function pinReason(pin: DeckPin): string {
		if (pin.via) return `${pin.via.relationLabel} ${pin.via.entityName}`;
		return pin.hopDistance === 0 ? tPinned.declaredPlace : tPinned.hopsFromPlace(pin.hopDistance);
	}

	function openNote(): void {
		noteText = '';
		noteOpen = true;
	}

	function cancelNote(): void {
		noteOpen = false;
		noteText = '';
	}

	async function submitNote(event: SubmitEvent, pinId: string): Promise<void> {
		event.preventDefault();
		const trimmed = noteText.trim();
		if (!trimmed || notePending) return;
		notePending = true;
		try {
			await onNote(trimmed, pinId);
			noteOpen = false;
			noteText = '';
		} finally {
			notePending = false;
		}
	}

	async function markRevealed(pinId: string): Promise<void> {
		if (revealPending || revealed.has(pinId)) return;
		revealPending = pinId;
		try {
			await onReveal(pinId);
			revealed.add(pinId);
		} finally {
			revealPending = null;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<p class="text-label text-muted" aria-live="polite" aria-atomic="true">
		{t.positionOf(index + 1, cards.length, currentName)}
	</p>

	<!-- The APG carousel pattern's own shape: a focusable `role="group"` region that
	     owns both the keyboard (arrow keys) and the pointer (swipe) gesture for the
	     card it currently shows, so a GM with a keyboard is never limited to the
	     strip below. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<section
		tabindex="0"
		role="group"
		aria-roledescription={t.roleDescription}
		aria-label={t.regionLabel}
		onkeydown={onKeydown}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		class="touch-pan-y rounded-lg border border-line bg-panel p-4 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
	>
		{#key cardKey}
			<div
				class="animate-in fade-in-0 {direction === 1
					? 'slide-in-from-right-4'
					: 'slide-in-from-left-4'} duration-move ease-arrive"
			>
				{#if current.kind === 'place'}
					<div class="flex items-center gap-2.5">
						<span
							class="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent-bg text-accent-ink"
							aria-hidden="true"
						>
							<MapPinIcon class="size-4" />
						</span>
						<div class="min-w-0">
							<h2 class="truncate text-title font-semibold text-ink">{placeName}</h2>
							<p class="text-label tracking-wide text-muted uppercase">{t.placeKind}</p>
						</div>
					</div>
					<p class="mt-3 text-body text-ink">{placeBrief ?? t.placeBriefEmpty}</p>
					<p class="mt-3 text-label font-semibold tracking-wide text-muted uppercase">
						{tHome.nearbyHeading}
					</p>
					<p class="mt-1 text-body text-ink">{placeContext ?? t.placeContextEmpty}</p>
				{:else}
					{@const pin = current.pin}
					<div class="flex items-start gap-2.5">
						<span
							class="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent-bg font-mono text-xs font-bold text-accent-ink"
							aria-hidden="true"
						>
							{initialsOf(pin.name)}
						</span>
						<div class="min-w-0 flex-1">
							<h2 class="truncate text-title font-semibold text-ink">{pin.name}</h2>
							<p class="text-label tracking-wide text-muted uppercase">{pin.type}</p>
						</div>
						{#if pin.hasPendingProposal}
							<Badge variant="accent">{t.pendingProposal}</Badge>
						{/if}
					</div>

					<p class="mt-3 text-body text-ink">
						{#if pin.warm.status === 'missing'}
							<span class="text-muted">{t.briefMissing}</span>
						{:else if pin.warm.text}
							{pin.warm.text}
						{:else}
							<span class="text-muted">{t.briefEmpty}</span>
						{/if}
					</p>
					{#if pin.warm.status === 'ready' && pin.warm.stale}
						<Badge variant="secondary" class="mt-1.5">{t.briefMayBeOutdated}</Badge>
					{/if}

					<p class="mt-2 text-label text-muted">{pinReason(pin)}</p>

					<div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
						<button
							type="button"
							onclick={() => (noteOpen ? cancelNote() : openNote())}
							aria-expanded={noteOpen}
							class="min-h-[44px] rounded-md border border-line-2 px-3 text-sm text-ink-2 hover:bg-panel-2"
						>
							{tNote.note}
						</button>
						<button
							type="button"
							onclick={() => markRevealed(pin.entityId)}
							disabled={!canReveal || revealPending === pin.entityId || revealed.has(pin.entityId)}
							title={canReveal ? undefined : tDock.markAsRevealedDisabledTitle}
							class="min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
						>
							{revealed.has(pin.entityId)
								? t.revealed
								: revealPending === pin.entityId
									? t.revealing
									: tDock.markAsRevealed}
						</button>
						<a
							href={resolve(`/w/${universeSlug}/e/${pin.slug}`)}
							class="inline-flex min-h-[44px] items-center rounded-md border border-line-2 px-3 text-sm text-ink-2 hover:bg-panel-2"
						>
							{t.openEntry}
						</a>
					</div>

					{#if noteOpen}
						<form
							onsubmit={(event) => submitNote(event, pin.entityId)}
							class="mt-3 flex flex-col gap-2 rounded-lg border border-line-2 bg-panel-2 p-3"
							aria-label={t.noteFormLabel(pin.name)}
						>
							<p class="text-label text-muted">
								{tNote.about}: <span class="text-ink">{pin.name}</span>
							</p>
							<p class="text-xs text-muted">{tNote.disclaimer}</p>
							<Textarea
								bind:value={noteText}
								rows={2}
								placeholder={tNote.notePlaceholder}
								aria-label={tNote.note}
							/>
							<div class="flex justify-end gap-2">
								<button
									type="button"
									onclick={cancelNote}
									class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
								>
									{tNote.cancel}
								</button>
								<button
									type="submit"
									disabled={!noteText.trim() || notePending}
									class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
								>
									{notePending ? tNote.savingAsProposal : tNote.saveAsProposal}
								</button>
							</div>
						</form>
					{/if}
				{/if}
			</div>
		{/key}
	</section>

	<nav class="flex gap-2 overflow-x-auto pb-1" aria-label={t.stripLabel}>
		<button
			type="button"
			onclick={() => goTo(0)}
			aria-current={index === 0 ? 'true' : undefined}
			class="max-w-[9rem] flex-none truncate rounded-md border border-line-2 px-3 py-2 text-sm"
			class:text-accent-ink={index === 0}
			class:font-semibold={index === 0}
			class:text-ink-2={index !== 0}
		>
			{placeName}
		</button>
		{#each pins as pin, i (pin.entityId)}
			<button
				type="button"
				onclick={() => goTo(i + 1)}
				aria-current={index === i + 1 ? 'true' : undefined}
				class="max-w-[9rem] flex-none truncate rounded-md border border-line-2 px-3 py-2 text-sm"
				class:text-accent-ink={index === i + 1}
				class:font-semibold={index === i + 1}
				class:text-ink-2={index !== i + 1}
			>
				{pin.name}
			</button>
		{/each}
	</nav>
</div>
