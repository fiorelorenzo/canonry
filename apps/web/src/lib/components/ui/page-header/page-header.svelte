<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * #147: the one page-level header shape, so a screen title stops being reinvented
	 * per route. shadcn has no equivalent (it ships controls, not page chrome), so this
	 * is one of the two components of our own the batch contract calls for. Copy is a
	 * caller concern - every string arrives as a prop, so this file has no English of
	 * its own to keep in step with `$lib/i18n`.
	 */
	let {
		title,
		eyebrow,
		description,
		actions
	}: {
		title: string;
		eyebrow?: string;
		description?: string;
		actions?: Snippet;
	} = $props();
</script>

<header class="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
	<div class="min-w-0">
		{#if eyebrow}
			<p class="mb-1 font-mono text-xs tracking-wide text-muted uppercase">{eyebrow}</p>
		{/if}
		<h1 class="text-2xl font-semibold text-ink">{title}</h1>
		{#if description}
			<p class="mt-2 max-w-measure text-ink-2">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>
