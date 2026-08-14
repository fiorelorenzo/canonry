<script lang="ts">
	/**
	 * C7 = A: five fixed chips plus a free-text escape hatch, shown right after a reject -
	 * "wrong" is a feature the ranker can use directly, and picking one (or skipping
	 * entirely) never blocks the queue, since the reject already happened before this
	 * renders (see `ProposalQueue.svelte`'s reject handler).
	 */
	const CHIPS: Array<{ label: string; value: string }> = [
		{ label: 'Wrong', value: 'wrong' },
		{ label: 'Already true', value: 'already true' },
		{ label: 'Not canon yet', value: 'not canon yet' },
		{ label: 'Too much', value: 'too much' },
		{ label: 'Prose', value: 'prose' }
	];

	let { onPick }: { onPick: (reason: string) => void } = $props();

	let showOther = $state(false);
	let otherText = $state('');

	function submitOther(): void {
		const value = otherText.trim();
		if (value) onPick(value);
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<span class="text-xs text-muted">Why not?</span>
	{#each CHIPS as chip (chip.value)}
		<button
			type="button"
			class="rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
			onclick={() => onPick(chip.value)}
		>
			{chip.label}
		</button>
	{/each}
	{#if showOther}
		<input
			type="text"
			class="rounded-md border border-line-2 bg-panel px-2 py-1 text-xs text-ink"
			placeholder="say more…"
			bind:value={otherText}
			onkeydown={(e) => e.key === 'Enter' && submitOther()}
		/>
		<button
			type="button"
			class="rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
			onclick={submitOther}
		>
			Save
		</button>
	{:else}
		<button
			type="button"
			class="rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
			onclick={() => (showOther = true)}
		>
			Other&hellip;
		</button>
	{/if}
</div>
