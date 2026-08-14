<script lang="ts">
	/**
	 * C5 = B: a dotted underline on the changed span; click opens a floating box with the
	 * quote and the plain-word reason. `forceOpen` renders it already open, un-closeable -
	 * the guardrail-3 case where the only evidence is embedding similarity, which must
	 * never be the one thing a skimming GM clicks past.
	 */
	import type { EvidenceView } from './evidence';

	let {
		views,
		forceOpen
	}: {
		views: EvidenceView[];
		forceOpen: boolean;
	} = $props();

	let open = $state(forceOpen);
</script>

{#if views.length > 0}
	<span class="evidence relative inline-block" class:forced={forceOpen}>
		<button
			type="button"
			class="ev inline items-center gap-1 border-b border-dotted border-ai-line text-inherit"
			aria-expanded={open}
			disabled={forceOpen}
			onclick={() => (open = !open)}
		>
			Evidence
		</button>
		{#if open}
			<span
				class="pop absolute top-full left-0 z-10 mt-1 w-72 rounded-md border border-ai-line bg-panel p-3 text-xs shadow-lg"
			>
				{#if forceOpen}
					<span
						class="mb-1.5 block font-mono text-[10px] font-bold tracking-wide text-ai uppercase"
					>
						Embedding similarity only
					</span>
				{/if}
				{#each views as view, i (i)}
					<span class="mb-2 block last:mb-0">
						{#if view.quote}
							<span class="block text-ink-2 italic">&ldquo;{view.quote}&rdquo;</span>
						{/if}
						<span class="block text-muted">{view.reason}</span>
					</span>
				{/each}
				{#if !forceOpen}
					<button
						type="button"
						class="mt-1 text-[11px] text-muted underline"
						onclick={() => (open = false)}
					>
						Close
					</button>
				{/if}
			</span>
		{/if}
	</span>
{/if}

<style>
	.ev {
		cursor: pointer;
		font: inherit;
		background: none;
		padding: 0;
	}
	.ev:disabled {
		cursor: default;
	}
</style>
