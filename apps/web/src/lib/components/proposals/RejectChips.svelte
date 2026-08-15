<script lang="ts">
	/**
	 * C7 = A: five fixed chips plus a free-text escape hatch, shown right after a reject -
	 * "wrong" is a feature the ranker can use directly, and picking one (or skipping
	 * entirely) never blocks the queue, since the reject already happened before this
	 * renders (see `ProposalQueue.svelte`'s reject handler).
	 *
	 * `value` is the stable English token `onPick` sends to `?/setRejectReason` and the
	 * ranker reads back later - never translated, only the visible `label` is (issue
	 * #121). `ProposalDiffCard.svelte`'s `rejectReasonLabel` maps a stored `value` back
	 * to this same label when redisplaying a rejected candidate's reason.
	 */
	import { messages, type Locale } from '$lib/i18n';

	let { onPick, locale }: { onPick: (reason: string) => void; locale: Locale } = $props();

	let t = $derived(messages(locale).proposals.rejectChips);

	let CHIPS = $derived<Array<{ label: string; value: string }>>([
		{ label: t.wrong, value: 'wrong' },
		{ label: t.alreadyTrue, value: 'already true' },
		{ label: t.notCanonYet, value: 'not canon yet' },
		{ label: t.tooMuch, value: 'too much' },
		{ label: t.prose, value: 'prose' }
	]);

	let showOther = $state(false);
	let otherText = $state('');

	function submitOther(): void {
		const value = otherText.trim();
		if (value) onPick(value);
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<span class="text-xs text-muted">{t.prompt}</span>
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
			placeholder={t.otherPlaceholder}
			bind:value={otherText}
			onkeydown={(e) => e.key === 'Enter' && submitOther()}
		/>
		<button
			type="button"
			class="rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
			onclick={submitOther}
		>
			{t.save}
		</button>
	{:else}
		<button
			type="button"
			class="rounded-md border border-line-2 px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
			onclick={() => (showOther = true)}
		>
			{t.other}
		</button>
	{/if}
</div>
