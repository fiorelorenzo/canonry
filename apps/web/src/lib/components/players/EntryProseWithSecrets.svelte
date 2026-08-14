<!--
	Decision E6 = A: secrets and GM notes as inline fenced blocks, with a preview toggle that
	renders exactly what a player would see. This is the GM's own entry view: the default
	render tags every `:::secret`/`:::gmnote` block (amber / red, matching the E6 artifact's
	mock), and "Player preview" swaps to `stripSecretsForPlayers` - the identical filter
	`apps/web/src/lib/server/players.ts` runs before an entry ever reaches `/p/**` - so what
	the GM sees in preview is never a second guess at what the real players' wiki does.

	Self-contained: takes exactly what the GM's existing read view already has in hand
	(`body`, `universeSlug`, `mentionTargets`), no server round trip, no new load data.
-->
<script lang="ts">
	import {
		renderMarkdown,
		renderMarkdownWithHighlight,
		type FactSpan,
		type MentionTarget
	} from '$lib/markdown';
	import {
		splitSecretBlocks,
		stripSecretsForPlayers,
		type SecretBlockKind
	} from '$lib/markdown-secrets';

	let {
		body,
		universeSlug,
		mentionTargets,
		highlightSpan = null
	}: {
		body: string;
		universeSlug: string;
		mentionTargets: MentionTarget[];
		highlightSpan?: FactSpan | null;
	} = $props();

	let playerPreview = $state(false);

	const BLOCK_LABEL: Record<SecretBlockKind, string> = {
		secret: 'Hidden \u00b7 unlocks on reveal',
		gmnote: 'GM note \u00b7 never shown to players'
	};

	// The GM view only, never the player preview: highlighting is Facts-panel span
	// highlighting (B4), which has no meaning once a span's own secret block has been
	// stripped for players. `highlightSpan` is an offset into the *original* `body`, so it
	// only applies to the one segment whose own [start, end) range contains it - every
	// other segment renders plain, exactly like it would with no highlight at all.
	let gmHtml = $derived(
		splitSecretBlocks(body)
			.map((segment) => {
				const local =
					highlightSpan && highlightSpan.start >= segment.start && highlightSpan.end <= segment.end
						? { start: highlightSpan.start - segment.start, end: highlightSpan.end - segment.start }
						: null;
				const html = local
					? renderMarkdownWithHighlight(segment.text, universeSlug, mentionTargets, local)
					: renderMarkdown(segment.text, universeSlug, mentionTargets);
				if (segment.kind === 'body') return html;
				return `<div class="${segment.kind}-block"><span class="block-tag">${BLOCK_LABEL[segment.kind]}</span>${html}</div>`;
			})
			.join('\n')
	);

	let playerHtml = $derived(
		renderMarkdown(stripSecretsForPlayers(body), universeSlug, mentionTargets)
	);
</script>

<div class="mb-4 flex items-center justify-between gap-2 border-b border-line pb-2">
	<span class="text-xs font-semibold tracking-wide text-muted uppercase">
		{playerPreview ? 'Player preview \u2014 what the party sees' : 'GM view'}
	</span>
	<button
		type="button"
		class="rounded-md border border-line-2 px-2.5 py-1 text-xs text-ink-2 hover:bg-panel-2"
		aria-pressed={playerPreview}
		onclick={() => (playerPreview = !playerPreview)}
	>
		{playerPreview ? 'Show GM view' : 'Player preview'}
	</button>
</div>

<div
	class="entry-prose-secrets max-w-measure text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-line-2 [&_blockquote]:pl-4 [&_blockquote]:text-ink-2 [&_blockquote]:italic [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
>
	<!-- markdown.ts renders with html:false so raw HTML in a body is escaped, and the secret
	     and gmnote wrappers come from this file's own fixed label table rather than from
	     content, so nothing user-authored reaches the DOM as markup. The directive has to be
	     the comment's last line to apply, which is why this is not one multi-line comment. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html playerPreview ? playerHtml : gmHtml}
</div>

<style>
	.entry-prose-secrets :global(a.mention) {
		color: var(--color-accent-ink);
		border-bottom: 1px solid var(--color-line-2);
		text-decoration: none;
	}
	.entry-prose-secrets :global(a.mention:hover) {
		background: var(--color-accent-bg);
	}
	.entry-prose-secrets :global(.mention-unresolved) {
		color: var(--color-danger);
		border-bottom: 1px dashed var(--color-line-2);
	}
	.entry-prose-secrets :global(.secret-block),
	.entry-prose-secrets :global(.gmnote-block) {
		display: block;
		border-radius: 0 6px 6px 0;
		padding: 8px 12px;
		margin: 10px 0;
	}
	.entry-prose-secrets :global(.secret-block) {
		background: var(--color-warn-bg);
		border-left: 3px solid var(--color-warn);
	}
	.entry-prose-secrets :global(.gmnote-block) {
		background: var(--color-danger-bg);
		border-left: 3px solid var(--color-danger);
	}
	.entry-prose-secrets :global(.block-tag) {
		display: block;
		font: 600 10px/1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 5px;
	}
	.entry-prose-secrets :global(.secret-block .block-tag) {
		color: var(--color-warn);
	}
	.entry-prose-secrets :global(.gmnote-block .block-tag) {
		color: var(--color-danger);
	}
</style>
