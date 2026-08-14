<script lang="ts">
	/**
	 * B2 = C's resolve menu: opens the same way whether `[[` or `@` triggered it, and a
	 * pick always inserts the canonical `[[Name]]` form directly (`editorState.ts`'s
	 * `applyMentionSelection`). No "create new entity" row here on purpose - B2's own
	 * "Rejected outright" section is explicit that auto-creating a relation, or an entity,
	 * from a menu pick is guardrail 1 broken twice over. That path is a `draft_entity`
	 * proposal (#47), not a shortcut this menu takes for you.
	 */
	import type { MentionTarget } from '$lib/markdown';

	let {
		query,
		matches,
		highlightedIndex,
		onSelect
	}: {
		query: string;
		matches: MentionTarget[];
		highlightedIndex: number;
		onSelect: (target: MentionTarget) => void;
	} = $props();
</script>

<div
	class="amenu w-full rounded-b-lg border border-t-0 border-line-2 bg-panel shadow-lg"
	role="listbox"
	aria-label="Mention suggestions"
>
	<div
		class="border-b border-line bg-panel-2 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted uppercase"
	>
		{matches.length > 0 ? `Matching "${query}"` : 'No exact match'}
	</div>
	{#if matches.length === 0}
		<p class="px-3 py-2 text-xs text-muted">
			No entry named &ldquo;{query}&rdquo; yet. Close it with <code>]]</code> to leave an unresolved mention.
		</p>
	{:else}
		<ul>
			{#each matches as target, i (target.slug)}
				<li>
					<button
						type="button"
						role="option"
						class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-panel-2"
						class:bg-panel-2={i === highlightedIndex}
						aria-selected={i === highlightedIndex}
						onclick={() => onSelect(target)}
					>
						<span class="text-ink-2">{target.name}</span>
						{#if target.aliases.length > 0}
							<span class="text-xs text-muted">alias: {target.aliases.join(', ')}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
