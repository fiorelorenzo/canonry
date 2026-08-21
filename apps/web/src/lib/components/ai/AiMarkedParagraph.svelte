<script lang="ts">
	/**
	 * C1 = B: unaccepted AI wording gets a dashed underline plus a numbered margin marker.
	 * Round eleven P1 (#344) gave that mark its own hue; round sixteen U10 (#454) deleted
	 * the hue after three rounds of it being misused elsewhere and put the mark on
	 * `--color-diff-line`, P3's own hue-less value signal, because the shape - dashed, not
	 * solid; a number, not a dot - was always the primary carrier and the wash was only
	 * ever support (C1's own reasoning, quoted in #454). See `aiMarking.ts` for the
	 * structural, colour-independent markup this renders and its own tests.
	 *
	 * The marker is an outline rather than a fill: `--color-diff-line` reads at 4.05:1
	 * (light) and 4.28:1 (dark) against the surfaces it borders, comfortably past the 3:1 a
	 * non-text mark needs, but not past the 4.5:1 a reversed 9px bold digit would need if
	 * it filled the badge. The digit itself is `--color-ink` on `--color-panel`, both near
	 * the ends of the palette's range, so its contrast is never in question.
	 *
	 * The entry's own written text never moves: `segments` marked `proposed: false` render
	 * exactly as typed, and a proposal's wording lives only in the (not yet built, #47)
	 * diff, never spliced into the entry itself.
	 */
	import { renderAiMarkedParagraph, type ParagraphSegment } from './aiMarking';

	let { segments }: { segments: ParagraphSegment[] } = $props();
	let html = $derived(renderAiMarkedParagraph(segments));
</script>

<div class="ai-marked-paragraph relative pl-6 leading-relaxed text-ink-2">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- html comes from renderAiMarkedParagraph, a pure escaping function in this same package, not from user input. -->
	{@html html}
</div>

<style>
	.ai-marked-paragraph :global(.ai-marker) {
		position: absolute;
		left: 0;
		top: 0.2em;
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 0.25rem;
		box-sizing: border-box;
		border: 1.5px solid var(--color-diff-line);
		background: var(--color-panel);
		color: var(--color-ink);
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		line-height: calc(0.95rem - 3px);
		text-align: center;
	}

	.ai-marked-paragraph :global(.ai-marked-text) {
		text-decoration: underline;
		text-decoration-style: dashed;
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
		text-decoration-color: var(--color-diff-line);
	}

	.ai-marked-paragraph :global(.ai-paragraph) {
		margin: 0;
	}
</style>
