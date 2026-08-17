<script lang="ts">
	/** The entry's document, B1 = C. Markdown in, decorated HTML out, via `$lib/markdown.ts`
	 * - the same renderer the editor's save action and the mention tests use, so the read
	 * view can never disagree with what a mention resolves to.
	 *
	 * `surface` is required rather than defaulted (#159): the only two current callers are
	 * the GM entry page and the public `/p/[universe]/[slug]` page, and each has to say
	 * which one it is rather than this component assuming - assuming is exactly how a
	 * mention on the public wiki ended up linking to the sign-in-walled GM route. */
	import {
		renderMarkdown,
		renderMarkdownWithHighlight,
		type FactSpan,
		type MentionSurface,
		type MentionTarget
	} from '$lib/markdown';

	let {
		body,
		universeSlug,
		mentionTargets,
		surface,
		highlightSpan = null
	}: {
		body: string;
		universeSlug: string;
		mentionTargets: MentionTarget[];
		surface: MentionSurface;
		highlightSpan?: FactSpan | null;
	} = $props();

	let html = $derived(
		highlightSpan
			? renderMarkdownWithHighlight(body, universeSlug, mentionTargets, highlightSpan, surface)
			: renderMarkdown(body, universeSlug, mentionTargets, surface)
	);
</script>

<div
	class="entry-prose max-w-measure text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-line-2 [&_blockquote]:pl-4 [&_blockquote]:text-ink-2 [&_blockquote]:italic [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown.ts escapes raw HTML -->
	{@html html}
</div>

<style>
	.entry-prose :global(a.mention) {
		color: var(--color-accent-ink);
		border-bottom: 1px solid var(--color-line-2);
		text-decoration: none;
	}
	.entry-prose :global(a.mention:hover) {
		background: var(--color-accent-bg);
	}
	.entry-prose :global(.mention-unresolved) {
		color: var(--color-danger);
		border-bottom: 1px dashed var(--color-line-2);
	}
	/* Deliberately not C1's violet and not B4's ai_accepted green: a fact span is evidence,
	   not a pending proposal and not a settled provenance badge, so it gets a third colour. */
	.entry-prose :global(mark.factspan) {
		background: var(--color-warn-bg);
		box-shadow: inset 0 -2px 0 var(--color-warn);
		border-radius: 2px;
		padding: 0 1px;
		color: inherit;
	}
</style>
