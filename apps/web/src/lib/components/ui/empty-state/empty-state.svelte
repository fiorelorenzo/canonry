<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * I8 (DECISIONS.md, #146/#147): one component, three variants, replacing nine
	 * hand-written empty-state sentences that used to each invent their own tone.
	 *
	 * `settled` never renders `action`, even if a caller passes one - not an omission,
	 * a decision built into which branch below even reads the prop. "Nothing left to
	 * review" is good news; a call-to-action next to it invents work nobody asked for,
	 * which is the same reasoning guardrail 1 uses against a bulk-accept button
	 * (AGENTS.md, DECISIONS.md's "Guardrail 1's wording" entry) - a surface that tells
	 * you a queue is empty is not the place to hand you another task in the same breath.
	 * `cold` (nothing here yet) and `derived` (nothing here because of how this universe
	 * was built) are both allowed to prompt further action; only `settled` is a full stop.
	 *
	 * Copy is a caller concern throughout - every string arrives as a prop, so this file
	 * has no English of its own to keep in step with `$lib/i18n`.
	 */
	let {
		kind,
		message,
		action,
		explanation
	}: {
		kind: 'cold' | 'settled' | 'derived';
		message: string;
		action?: Snippet;
		explanation?: string;
	} = $props();
</script>

{#if kind === 'settled'}
	<p class="py-8 text-center text-sm text-muted">{message}</p>
{:else if kind === 'derived'}
	<div class="rounded-lg border border-line bg-panel-2 p-6 text-center">
		<p class="text-ink-2">{message}</p>
		{#if explanation}
			<p class="mt-2 text-sm text-muted">{explanation}</p>
		{/if}
		{#if action}
			<div class="mt-3 flex justify-center">
				{@render action()}
			</div>
		{/if}
	</div>
{:else}
	<div class="rounded-lg border border-dashed border-line-2 bg-panel p-8 text-center">
		<p class="text-ink-2">{message}</p>
		{#if action}
			<div class="mt-4 flex justify-center">
				{@render action()}
			</div>
		{/if}
	</div>
{/if}
