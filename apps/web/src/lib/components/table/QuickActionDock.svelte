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
	let {
		canReveal,
		npcPending,
		onMarkRevealed,
		onNpcHere,
		onCreateLocation,
		onJotNote
	}: {
		canReveal: boolean;
		npcPending: boolean;
		onMarkRevealed: () => void;
		onNpcHere: () => void;
		onCreateLocation: (label: string) => void;
		onJotNote: () => void;
	} = $props();

	let overflowOpen = $state(false);
	let locationFormOpen = $state(false);
	let locationLabel = $state('');

	function submitLocation(event: SubmitEvent) {
		event.preventDefault();
		const label = locationLabel.trim();
		if (!label) return;
		onCreateLocation(label);
		locationLabel = '';
		locationFormOpen = false;
		overflowOpen = false;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<button
		type="button"
		onclick={onMarkRevealed}
		disabled={!canReveal}
		title={canReveal ? undefined : 'Declare a session to mark places as revealed'}
		class="min-h-[44px] min-w-[78px] rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
	>
		Mark as revealed
	</button>
	<button
		type="button"
		onclick={onNpcHere}
		disabled={npcPending}
		class="min-h-[44px] min-w-[78px] rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-60"
	>
		{npcPending ? 'Drafting…' : '+ NPC here'}
	</button>
	<div class="relative">
		<button
			type="button"
			onclick={() => (overflowOpen = !overflowOpen)}
			class="min-h-[44px] rounded-md border border-line-2 px-3 py-2.5 text-sm text-ink-2 hover:bg-panel-2"
			aria-expanded={overflowOpen}
		>
			More &#9662;
		</button>
		{#if overflowOpen}
			<div
				class="absolute top-[calc(100%+6px)] left-0 z-10 flex min-w-[220px] flex-col gap-1 rounded-md border border-line-2 bg-panel p-1.5 shadow-lg"
			>
				{#if locationFormOpen}
					<form onsubmit={submitLocation} class="flex flex-col gap-1.5 p-1.5">
						<label for="table-location-label" class="text-xs text-muted"
							>Name the child location</label
						>
						<input
							id="table-location-label"
							type="text"
							bind:value={locationLabel}
							placeholder="e.g. The Salt Cellar"
							class="rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-sm text-ink"
						/>
						<button
							type="submit"
							class="rounded-md bg-accent px-2 py-1 text-xs font-medium text-panel hover:bg-accent-ink"
						>
							Create
						</button>
					</form>
				{:else}
					<button
						type="button"
						onclick={() => (locationFormOpen = true)}
						class="rounded-md px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-panel-2"
					>
						+ Create a child location
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
					Jot a note
				</button>
			</div>
		{/if}
	</div>
</div>
