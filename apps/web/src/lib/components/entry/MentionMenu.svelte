<script lang="ts">
	/**
	 * B2 = C's resolve menu: opens the same way whether `[[` or `@` triggered it, and a
	 * pick always inserts the canonical `[[Name]]` form directly (`editorState.ts`'s
	 * `applyMentionSelection`). No "create new entity" row here on purpose - B2's own
	 * "Rejected outright" section is explicit that auto-creating a relation, or an entity,
	 * from a menu pick is guardrail 1 broken twice over. That path is a `draft_entity`
	 * proposal (#47), not a shortcut this menu takes for you.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import type { MentionTarget } from '$lib/markdown';

	let {
		query,
		matches,
		highlightedIndex,
		onSelect,
		locale
	}: {
		query: string;
		matches: MentionTarget[];
		highlightedIndex: number;
		onSelect: (target: MentionTarget) => void;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));
</script>

<div
	class="amenu w-full rounded-b-lg border border-t-0 border-line-2 bg-panel shadow-elevated"
	role="listbox"
	aria-label={t.entry.mentionMenu.ariaLabel}
>
	<div
		class="border-b border-line bg-panel-2 px-3 py-1.5 font-mono text-label tracking-wide text-muted uppercase"
	>
		{matches.length > 0 ? t.entry.mentionMenu.matching(query) : t.entry.mentionMenu.noExactMatch}
	</div>
	{#if matches.length === 0}
		<p class="px-3 py-2 text-label text-muted">
			{t.entry.mentionMenu.noMatchBefore(query)} <code>]]</code>
			{t.entry.mentionMenu.noMatchAfter}
		</p>
	{:else}
		<ul>
			{#each matches as target, i (target.slug)}
				<li>
					<Button
						type="button"
						variant="ghost"
						role="option"
						class={`h-auto w-full items-center justify-between gap-2 rounded-none px-3 py-2 text-left text-sm font-normal ${i === highlightedIndex ? 'bg-panel-2' : ''}`}
						aria-selected={i === highlightedIndex}
						onclick={() => onSelect(target)}
					>
						<span class="text-ink-2">{target.name}</span>
						{#if target.aliases.length > 0}
							<span class="text-label text-muted"
								>{t.entry.mentionMenu.aliasLabel(target.aliases.join(', '))}</span
							>
						{/if}
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
