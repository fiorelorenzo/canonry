<!--
	Decision E6 = A: secrets and GM notes as inline fenced blocks, with a preview toggle that
	renders exactly what a player would see. This is the GM's own entry view: the default
	render tags every `:::secret`/`:::gmnote` block (amber / red, matching the E6 artifact's
	mock), and "Player preview" swaps to `stripSecretsForPlayers` - the identical filter
	`apps/web/src/lib/server/players.ts` runs before an entry ever reaches `/p/**` - so what
	the GM sees in preview is never a second guess at what the real players' wiki does.

	Self-contained: takes exactly what the GM's existing read view already has in hand
	(`body`, `universeSlug`, `mentionTargets`, `publicMentionTargets`), no server round trip,
	no new load data. `publicMentionTargets` is `$lib/server/players.ts`'s
	`publicMentionTargetsFrom(mentionTargets)` (#220), computed once in the GM route's own
	`load` alongside the one query that already fetches every entity to resolve mentions
	against (#105/#15) - so a `gm_only` mention renders exactly as it does on the real `/p/`
	page instead of resolving against this route's full unfiltered list, and the toggle
	itself fetches nothing. That filtering has to happen server-side rather than in this
	component: `publicMentionTargetsFrom` goes through `@canonry/db` (the `postgres` driver
	included), and this component ships to the browser.
-->
<script lang="ts">
	import {
		renderMarkdown,
		renderMarkdownWithHighlight,
		type FactSpan,
		type MentionTarget
	} from '$lib/markdown';
	import { splitSecretBlocks, stripSecretsForPlayers, type SecretBlockKind } from '@canonry/lang';
	import { Segmented, type SegmentedOption } from '$lib/components/ui/segmented';
	import {
		splitBodyIntoBlocks,
		markedProposalFor,
		renderChangeBar,
		type MarkedProposalRef
	} from '$lib/components/ai/entryMarking';
	import MentionPreview from '$lib/components/entry/MentionPreview.svelte';
	import { messages, type Locale } from '$lib/i18n';

	let {
		body,
		universeSlug,
		mentionTargets,
		publicMentionTargets,
		locale,
		highlightSpan = null,
		markedSentences = new Map<string, MarkedProposalRef>(),
		view = $bindable<'gm' | 'player'>('gm'),
		showViewControl = true
	}: {
		body: string;
		universeSlug: string;
		mentionTargets: MentionTarget[];
		publicMentionTargets: MentionTarget[];
		locale: Locale;
		highlightSpan?: FactSpan | null;
		/** V6 = A, #499: every sentence (exact strings, `packages/copilot`'s `semanticDiff`
		 * normalisation) a pending `update` proposal targets on this entity, mapped to the
		 * proposal that targets it. Empty by default - an entity with nothing pending
		 * renders exactly as before. GM view only: "something is waiting here" has no
		 * meaning in a player preview, which never shows anything but accepted canon. */
		markedSentences?: ReadonlyMap<string, MarkedProposalRef>;
		/** #409, S4, round fourteen: the view is a two-option choice, not a checkbox, so it
		 * is `Segmented`'s own string value. Bindable since round fifteen, for two callers
		 * that both host the control themselves: the entry page puts it under the title
		 * (T1, #428) and the editor puts it on its toolbar row (T6, #433). Either way this
		 * component still derives `playerPreview` and everything downstream from it. */
		view?: 'gm' | 'player';
		/** `false` suppresses this component's own copy of the `Segmented` *and* the
		 * one-line sentence beneath it, for a caller that renders the control itself
		 * (`view` bound in) and is now responsible for printing the sentence too. The
		 * rule, fixed here after #452 (round sixteen U4) found it printed twice on the
		 * entry page: whoever draws the segmented control draws the sentence under it,
		 * exactly once - never both this component and the caller, never neither. `true`
		 * (the default) means this component owns both; `false` hands both to the
		 * caller, which must then print the sentence itself. A future lift of this
		 * control MUST move its sentence along with it, not leave a copy behind. */
		showViewControl?: boolean;
	} = $props();

	let t = $derived(messages(locale).entry);

	let playerPreview = $derived(view === 'player');

	// #148/#383, updated #409: this component mounts twice (the entry page, the editor's
	// preview), and a bare literal `name` would collide if either page ever nested them -
	// `$props.id()` gives each mounted instance its own suffix, the same pattern
	// `ShellUserRow.svelte` uses for its own locale form for the identical reason. Segmented
	// groups its native radios by `name`, which is what this now keeps apart between mounts.
	const viewUid = $props.id();
	const viewName = `entry-view-${viewUid}`;

	const viewOptions: SegmentedOption[] = $derived([
		{ value: 'gm', label: t.prose.gmView },
		{ value: 'player', label: t.prose.playersView }
	]);

	const BLOCK_LABEL: Record<SecretBlockKind, string> = $derived({
		secret: t.secrets.hiddenBlock,
		gmnote: t.secrets.gmNoteBlock
	});

	// V6 = A, #499: where a block's change bar goes. A proposal inside a plan opens that
	// plan's own review page, the same fallback the "candidates with no draft yet" note
	// beneath the entry's own review region already uses; a proposal outside any plan
	// (Ask's own drafted proposal, #53, which never joins one) falls back to the plain
	// inbox route. Never the diff itself spliced onto this page - that surface is #498's
	// this round, and the entry page only ever points at it.
	function changeBarHref(ref: MarkedProposalRef): string {
		return ref.planId
			? `/w/${universeSlug}/proposals/${ref.planId}`
			: `/w/${universeSlug}/proposals`;
	}

	// The GM view only, never the player preview: highlighting is Facts-panel span
	// highlighting (B4), which has no meaning once a span's own secret block has been
	// stripped for players. `highlightSpan` is an offset into the *original* `body`, so it
	// only applies to the one segment whose own [start, end) range contains it - every
	// other segment renders plain, exactly like it would with no highlight at all.
	//
	// A segment under an active fact highlight never also carries a change bar: a GM who
	// just clicked a fact is reading that specific span, and layering "something else is
	// also waiting on part of this" on top of it is a second signal competing for the
	// same few words. The bar is still there the moment the highlight is cleared.
	let gmHtml = $derived(
		splitSecretBlocks(body)
			.map((segment) => {
				const local =
					highlightSpan && highlightSpan.start >= segment.start && highlightSpan.end <= segment.end
						? { start: highlightSpan.start - segment.start, end: highlightSpan.end - segment.start }
						: null;

				let html: string;
				if (!local && segment.kind === 'body' && markedSentences.size > 0) {
					html = splitBodyIntoBlocks(segment.text)
						.map((block) => {
							const rendered = renderMarkdown(block.raw, universeSlug, mentionTargets, 'gm');
							const proposal = markedProposalFor(block, markedSentences);
							return proposal
								? renderChangeBar(rendered, changeBarHref(proposal), t.prose.changeBarLabel)
								: rendered;
						})
						.join('\n');
				} else {
					html = local
						? renderMarkdownWithHighlight(segment.text, universeSlug, mentionTargets, local, 'gm')
						: renderMarkdown(segment.text, universeSlug, mentionTargets, 'gm');
				}

				if (segment.kind === 'body') return html;
				return `<div class="${segment.kind}-block"><span class="block-tag">${BLOCK_LABEL[segment.kind]}</span>${html}</div>`;
			})
			.join('\n')
	);

	// The public surface, deliberately: this preview's whole point is showing exactly what
	// the real `/p/**` render produces (this file's own header comment), which means the
	// same href rule EntryProse.svelte uses there, not the GM route's - and `publicMention
	// Targets`, the same list the GM route's own `load` derived from `@canonry/db`'s
	// `publicMentionTargets` predicate (#220), not this route's full `mentionTargets`. A
	// `gm_only` mention resolves to nothing here exactly like it does on `/p/**`, with no
	// extra fetch on toggle: `publicMentionTargets` arrived with the rest of this page's data.
	let playerHtml = $derived(
		renderMarkdown(stripSecretsForPlayers(body), universeSlug, publicMentionTargets, 'public')
	);

	// #364. The card follows the surface the prose was rendered for rather than the route it
	// sits on: in player preview the mentions carry `/p/**` hrefs resolved against
	// `publicMentionTargets`, so their cards come from the public endpoint too and a GM
	// checking the preview sees the same excerpt, and the same withheld `gm_only` entry, a
	// player would. Anything less and the toggle would stop being a preview of the real thing.
	let container = $state<HTMLElement | null>(null);
</script>

{#if showViewControl}
	<div class="mb-4 border-b border-line pb-3">
		<!-- O4 = B, #409 (S4, round fourteen, amends R8's Switch for this one control): a
		     binary state gets a segmented control, the same shape the editor's own
		     write/preview switch (MarkdownEditor.svelte) uses. Two fixed-length labels never
		     resize the control's own box, and the sentence below is a second, always-present
		     line rather than a label that swaps size - so using this never moves the article
		     that follows it. -->
		<Segmented
			name={viewName}
			bind:value={view}
			options={viewOptions}
			ariaLabel={t.prose.viewAriaLabel}
		/>
		<p class="mt-2 text-xs text-muted">
			{playerPreview ? t.prose.playerPreviewActive : t.prose.gmViewDescription}
		</p>
	</div>
{/if}

<div
	bind:this={container}
	class="entry-prose-secrets relative max-w-measure text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-line-2 [&_blockquote]:pl-4 [&_blockquote]:text-ink-2 [&_blockquote]:italic [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:mb-1 [&_p]:mb-4 [&_p]:leading-relaxed [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6"
>
	<!-- markdown.ts renders with html:false so raw HTML in a body is escaped, and the secret
	     and gmnote wrappers come from this file's own fixed label table rather than from
	     content, so nothing user-authored reaches the DOM as markup. The directive has to be
	     the comment's last line to apply, which is why this is not one multi-line comment. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html playerPreview ? playerHtml : gmHtml}
	<MentionPreview {container} {universeSlug} surface={playerPreview ? 'public' : 'gm'} {locale} />
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
	/* V6 = A, #499: a thin change bar in the margin, on `--color-diff-line` (P3's own
	   value signal), replacing C1's dashed underline and numbered marker here - this is
	   the GM's own accepted canon, and the bar carries no claim about who wrote it, only
	   that a proposal is waiting. A real `<a>` spanning the block's full height rather
	   than a narrow line, so the click target is not a hairline: the bar itself is drawn
	   with `::before`, centred inside that wider strip. */
	.entry-prose-secrets :global(.ai-change-bar-block) {
		position: relative;
		padding-left: 1rem;
	}
	.entry-prose-secrets :global(.ai-change-bar) {
		position: absolute;
		inset: 0 auto 0 0;
		width: 1rem;
		display: block;
		border-radius: 2px;
	}
	.entry-prose-secrets :global(.ai-change-bar::before) {
		content: '';
		position: absolute;
		left: 0.35rem;
		top: 0;
		bottom: 0;
		width: 3px;
		border-radius: 2px;
		background: var(--color-diff-line);
	}
	.entry-prose-secrets :global(.ai-change-bar:hover::before) {
		width: 4px;
	}
	.entry-prose-secrets :global(.ai-change-bar:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
