<script lang="ts">
	/**
	 * G5's side panel (DECISIONS.md round two, "expand in place, amended": a source
	 * click opens a side panel holding that entry, no preview and no navigation).
	 * Round eighteen's W3 reaffirms it unamended for the record page. Pure
	 * presentation - the caller (`ask/+page.svelte`, `ask/[conversationId]/+page.svelte`)
	 * owns the fetch and the open/loading state, because the caller is also what
	 * renders the `AskConversationGroup` rows whose `onOpenEntry` feeds this: one panel
	 * shared by every row on the page, not one per row.
	 *
	 * Same shape `AskConversation.svelte` used before the reversal: a `border-l`
	 * column, never a floating card (V3), no shadow, wearing the theme's own paper.
	 */
	import { Button } from '$lib/components/ui/button';

	let {
		loading,
		entry,
		closeLabel,
		loadingLabel,
		onClose
	}: {
		loading: boolean;
		entry: { name: string; type: string; body: string } | null;
		closeLabel: string;
		loadingLabel: string;
		onClose: () => void;
	} = $props();
</script>

<aside class="w-full flex-none border-t border-line bg-panel p-6 md:w-80 md:border-t-0 md:border-l">
	{#if loading}
		<p class="text-body text-muted">{loadingLabel}</p>
	{:else if entry}
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="text-label tracking-wide text-muted uppercase">{entry.type}</p>
				<h2 class="mt-0.5 text-title text-ink">{entry.name}</h2>
			</div>
			<Button type="button" variant="ghost" size="sm" onclick={onClose}>{closeLabel}</Button>
		</div>
		<p class="mt-4 text-body leading-relaxed whitespace-pre-wrap text-ink-2">
			{entry.body}
		</p>
	{/if}
</aside>
