<script lang="ts">
	/**
	 * C1 = B: unaccepted AI wording gets a dashed underline plus a numbered margin marker,
	 * in the violet reserved for the copilot (A1). The shape (dashed, not solid) and the
	 * marker (a number, not a dot) carry the meaning, so the marking still reads once
	 * colour is taken away - see `aiMarking.ts` for the structural, colour-independent
	 * markup this renders and its own tests.
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
		background: var(--color-ai);
		color: #fff;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		line-height: 0.95rem;
		text-align: center;
	}

	.ai-marked-paragraph :global(.ai-marked-text) {
		text-decoration: underline;
		text-decoration-style: dashed;
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
		text-decoration-color: var(--color-ai);
	}

	.ai-marked-paragraph :global(.ai-paragraph) {
		margin: 0;
	}
</style>
