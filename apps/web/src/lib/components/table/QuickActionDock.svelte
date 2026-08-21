<script lang="ts">
	/**
	 * Issue #74, decision E3 = C: a two-tier dock. Primary row, thumb-sized (E4's own spec:
	 * "78x48px tab target" carries over to these two big buttons, the ones a running
	 * campaign reaches for almost every session): mark as revealed, + NPC here. Everything
	 * else - create a child location, jot a note - sits one tap behind "More".
	 *
	 * "A quick action is a shortcut to *starting* a proposal, never a shortcut past
	 * reviewing one" (e3-quick-actions.html) - every branch here either fires instantly at
	 * the parent (which shows the resulting toast/proposal) or opens a small form first
	 * (location's name, the note's text) rather than ever writing canon directly.
	 */
	import { messages, type Locale } from '$lib/i18n';

	let {
		canReveal,
		npcPending,
		locale,
		locationPending = false,
		onMarkRevealed,
		onNpcHere,
		onCreateLocation,
		onJotNote
	}: {
		canReveal: boolean;
		npcPending: boolean;
		locale: Locale;
		/** #497 (V11): true while the parent's own `fetch` (`fireAction('location', ...)`)
		 * is in flight - `submitLocation` below awaits `onCreateLocation` rather than
		 * closing the mini-form the instant it fires, precisely so this has a window to
		 * be seen rather than being true for zero rendered frames. */
		locationPending?: boolean;
		onMarkRevealed: () => void;
		onNpcHere: () => void;
		onCreateLocation: (label: string) => Promise<void>;
		onJotNote: () => void;
	} = $props();

	const t = $derived(messages(locale).table);

	let overflowOpen = $state(false);
	let locationFormOpen = $state(false);
	let locationLabel = $state('');

	async function submitLocation(event: SubmitEvent) {
		event.preventDefault();
		const label = locationLabel.trim();
		if (!label) return;
		await onCreateLocation(label);
		locationLabel = '';
		locationFormOpen = false;
		overflowOpen = false;
	}
</script>

<!-- #147: every control in this dock stays bespoke. E3's two-tier dock (the two big
	thumb-sized primary actions plus the "More" overflow) is its own designed thing, not
	a set of generic buttons, so it keeps its own sizing and styling end to end. -->
<div class="flex flex-wrap items-center gap-2">
	<button
		type="button"
		onclick={onMarkRevealed}
		disabled={!canReveal}
		title={canReveal ? undefined : t.quickActionDock.markAsRevealedDisabledTitle}
		class="min-h-[44px] min-w-[78px] rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
	>
		{t.quickActionDock.markAsRevealed}
	</button>
	<button
		type="button"
		onclick={onNpcHere}
		disabled={npcPending}
		class="min-h-[44px] min-w-[78px] rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
	>
		{npcPending ? t.quickActionDock.drafting : t.actionLabels.npcHere}
	</button>
	<div class="relative">
		<button
			type="button"
			onclick={() => (overflowOpen = !overflowOpen)}
			class="min-h-[44px] rounded-md border border-line-2 px-3 py-2.5 text-sm text-ink-2 hover:bg-panel-2"
			aria-expanded={overflowOpen}
		>
			{t.quickActionDock.more} &#9662;
		</button>
		{#if overflowOpen}
			<div
				class="absolute top-[calc(100%+6px)] left-0 z-10 flex min-w-[220px] flex-col gap-1 rounded-md border border-line-2 bg-panel p-1.5 shadow-lg"
			>
				{#if locationFormOpen}
					<form onsubmit={submitLocation} class="flex flex-col gap-1.5 p-1.5">
						<label for="table-location-label" class="text-xs text-muted"
							>{t.quickActionDock.nameChildLocation}</label
						>
						<input
							id="table-location-label"
							type="text"
							bind:value={locationLabel}
							placeholder={t.quickActionDock.locationPlaceholder}
							class="rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-sm text-ink"
						/>
						<button
							type="submit"
							disabled={locationPending}
							class="rounded-md bg-accent px-2 py-1 text-xs font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
						>
							{locationPending ? t.quickActionDock.creating : t.quickActionDock.create}
						</button>
					</form>
				{:else}
					<button
						type="button"
						onclick={() => (locationFormOpen = true)}
						class="rounded-md px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-panel-2"
					>
						{t.actionLabels.createChildLocation}
					</button>
				{/if}
				<button
					type="button"
					onclick={() => {
						overflowOpen = false;
						onJotNote();
					}}
					class="rounded-md px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-panel-2"
				>
					{t.quickActionDock.jotNote}
				</button>
			</div>
		{/if}
	</div>
</div>
