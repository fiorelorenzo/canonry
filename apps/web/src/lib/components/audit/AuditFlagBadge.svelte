<script lang="ts">
	/**
	 * C9 = B: "a badge on the entry" - the quiet marker docs/ux/c9-audit-flags.html locks
	 * in, next to the entry title. Hidden entirely at zero rather than rendered as "0":
	 * the artifact's own costs section names this exactly ("a badge that only shows a
	 * count risks reading as a health indicator over time, '0' looks like a pass, which
	 * guardrail 7 forbids implying"), so "no badge" and "zero flags" have to look
	 * different, not the same badge showing "0".
	 */
	let { count, onOpen }: { count: number; onOpen: () => void } = $props();
</script>

{#if count > 0}
	<button
		type="button"
		onclick={onOpen}
		class="inline-flex flex-none items-center rounded-full border border-warn bg-warn-bg px-2 py-0.5 font-mono text-xs font-semibold text-warn hover:brightness-95"
	>
		{count === 1 ? '1 to check' : `${count} to check`}
	</button>
{/if}
