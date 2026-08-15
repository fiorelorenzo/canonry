<script lang="ts">
	/** Shared chrome for a standalone prose document (issues #109, #110): an optional
	 * eyebrow, a title, and a body column held to the same comfortable measure the
	 * entry body uses (`--container-measure`, `EntryProse.svelte`). Text documents
	 * rather than app surfaces, so the body keeps its own light wrapper, but the
	 * landmark and the page title now come from the shared shell and control layer:
	 * `AppShell.svelte` (#104) already renders the one `<main id="main">` for every
	 * route including this one, and the sidebar it renders alongside makes a
	 * hand-rolled "back to X" link redundant. #147 dropped both from here rather
	 * than leave a second landmark and a link nothing needs any more, and the
	 * title/eyebrow block now renders through `PageHeader` from the control layer
	 * instead of its own markup.
	 *
	 * The body selectors below mirror `EntryProse.svelte`'s hand-rolled prose rules
	 * rather than Tailwind Typography's `prose` class: the entry body deliberately
	 * skips that plugin's own colour palette in favour of this design system's
	 * tokens, and a docs page reads oddly next to canon prose if it looks different.
	 */
	import type { Snippet } from 'svelte';
	import { PageHeader } from '$lib/components/ui/page-header';

	let {
		title,
		eyebrow,
		children
	}: {
		title: string;
		eyebrow?: string;
		children: Snippet;
	} = $props();
</script>

<div class="mx-auto max-w-measure px-8 py-10">
	<PageHeader {eyebrow} {title} />

	<div
		class="docs-prose mt-6 text-ink-2 [&_a]:text-accent-ink [&_a]:underline [&_a]:decoration-line-2 [&_a]:underline-offset-2 [&_a]:hover:bg-accent-bg [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mb-1 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
	>
		{@render children()}
	</div>
</div>
