<script lang="ts">
	/** Shared chrome for a standalone prose document (issues #109, #110): a back link,
	 * an optional eyebrow, a title, and a body column held to the same comfortable
	 * measure the entry body uses (`--container-measure`, `EntryProse.svelte`). Text
	 * documents rather than app surfaces, so they get their own light wrapper instead
	 * of the app shell's sidebar (#104 owns that layout, not this).
	 *
	 * The body selectors below mirror `EntryProse.svelte`'s hand-rolled prose rules
	 * rather than Tailwind Typography's `prose` class: the entry body deliberately
	 * skips that plugin's own colour palette in favour of this design system's
	 * tokens, and a docs page reads oddly next to canon prose if it looks different.
	 */
	import type { ResolvedPathname } from '$app/types';
	import type { Snippet } from 'svelte';

	let {
		title,
		eyebrow,
		backHref,
		backLabel,
		children
	}: {
		title: string;
		eyebrow?: string;
		/** Built by `resolve()` at the call site. Typed as `ResolvedPathname` rather than
		 * `string` so `svelte/no-navigation-without-resolve` can see, through the type,
		 * that it already went through `resolve()` instead of flagging every href that
		 * is not a literal `resolve(...)` call in this file. */
		backHref: ResolvedPathname;
		backLabel: string;
		children: Snippet;
	} = $props();
</script>

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={backHref} class="text-sm text-accent hover:underline">&larr; {backLabel}</a>

	{#if eyebrow}
		<p class="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{eyebrow}</p>
	{/if}
	<h1 class="text-2xl font-semibold text-ink {eyebrow ? 'mt-1' : 'mt-4'}">{title}</h1>

	<div
		class="docs-prose mt-6 text-ink-2 [&_a]:text-accent-ink [&_a]:underline [&_a]:decoration-line-2 [&_a]:underline-offset-2 [&_a]:hover:bg-accent-bg [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mb-1 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
	>
		{@render children()}
	</div>
</main>
