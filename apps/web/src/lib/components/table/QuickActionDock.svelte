<script lang="ts">
	/**
	 * Issue #74/#529 (round eighteen, W1 = A): the persistent action bar at the foot of
	 * the board. E3 = C's two-tier dock - two thumb-sized primaries plus everything else
	 * one tap behind "More" - is explicitly rejected by this decision: "at a table an
	 * extra tap is where a GM stops using the product and goes back to their notes."
	 * Every action here is reachable in the one tap that fires it, or the one tap that
	 * opens the small field it needs (naming a child location) - never a second tap
	 * through an overflow first. "Jot a note" moved out of this bar entirely: it is its
	 * own persistent section on the board now ("A quick note"), not a quick action.
	 *
	 * "A quick action is a shortcut to *starting* a proposal, never a shortcut past
	 * reviewing one" (e3-quick-actions.html) - every branch here either fires instantly at
	 * the parent (which shows the resulting toast) or opens a small inline form first
	 * (the location's name) rather than ever writing canon directly.
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
		onSearchFocus
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
		/** #529: "search" is always on the board (`InstantSearch` never hides), so the
		 * fourth action bar item just moves focus to it rather than opening anything. */
		onSearchFocus: () => void;
	} = $props();

	const t = $derived(messages(locale).table);
	const tControls = $derived(messages(locale).controls);

	let locationFormOpen = $state(false);
	let locationLabel = $state('');

	async function submitLocation(event: SubmitEvent) {
		event.preventDefault();
		const label = locationLabel.trim();
		if (!label) return;
		await onCreateLocation(label);
		locationLabel = '';
		locationFormOpen = false;
	}
</script>

<!-- #147: every control in this bar stays bespoke, sized for a thumb at a lit table
	(44px minimum), not shadcn's own Button sizing. -->
<div
	class="flex flex-wrap items-center gap-2 border-t border-line bg-paper py-3"
	aria-label={t.quickActionDock.barLabel}
>
	<button
		type="button"
		onclick={onNpcHere}
		disabled={npcPending}
		class="min-h-[44px] min-w-[78px] rounded-md bg-accent px-4 py-2.5 text-body font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
	>
		{npcPending ? t.quickActionDock.drafting : t.actionLabels.npcHere}
	</button>
	<button
		type="button"
		onclick={onMarkRevealed}
		disabled={!canReveal}
		title={canReveal ? undefined : t.quickActionDock.markAsRevealedDisabledTitle}
		class="min-h-[44px] min-w-[78px] rounded-md bg-accent px-4 py-2.5 text-body font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
	>
		{t.quickActionDock.markAsRevealed}
	</button>
	{#if locationFormOpen}
		<form onsubmit={submitLocation} class="flex items-center gap-1.5">
			<input
				id="table-location-label"
				type="text"
				bind:value={locationLabel}
				placeholder={t.quickActionDock.locationPlaceholder}
				aria-label={t.quickActionDock.nameChildLocation}
				class="min-h-[44px] rounded-md border border-line-2 bg-panel-2 px-2 text-body text-ink"
			/>
			<button
				type="submit"
				disabled={locationPending}
				class="min-h-[44px] rounded-md bg-accent px-3 text-body font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
			>
				{locationPending ? t.quickActionDock.creating : t.quickActionDock.create}
			</button>
			<button
				type="button"
				onclick={() => {
					locationFormOpen = false;
					locationLabel = '';
				}}
				class="min-h-[44px] rounded-md border border-line-2 px-3 text-body text-ink-2 hover:bg-panel-2"
			>
				{t.quickNoteForm.cancel}
			</button>
		</form>
	{:else}
		<button
			type="button"
			onclick={() => (locationFormOpen = true)}
			class="min-h-[44px] rounded-md border border-line-2 px-3 text-body text-ink-2 hover:bg-panel-2"
		>
			{t.actionLabels.createChildLocation}
		</button>
	{/if}
	<button
		type="button"
		onclick={onSearchFocus}
		class="min-h-[44px] rounded-md border border-line-2 px-3 text-body text-ink-2 hover:bg-panel-2"
	>
		{tControls.search}
	</button>
</div>
