<script lang="ts">
	/** A boxed aside inside a docs page body, for a fact a GM has to see before acting
	 * rather than one more paragraph in the flow: a free-tier gap, a platform limit, a
	 * format that isn't readable yet. `warn` reuses the same warn tokens
	 * `EntryProse.svelte` uses for a fact span, `note` is the neutral panel tone used
	 * elsewhere for a secondary surface (`UniverseSwitcher.svelte`). */
	import type { Snippet } from 'svelte';

	let { tone = 'note', children }: { tone?: 'note' | 'warn'; children: Snippet } = $props();
</script>

<div
	class="my-4 rounded-md border px-4 py-3 text-sm leading-relaxed {tone === 'warn'
		? 'border-warn bg-warn-bg text-ink'
		: 'border-line-2 bg-panel-2 text-ink-2'}"
>
	{@render children()}
</div>
