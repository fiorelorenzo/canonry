<script lang="ts" module>
	export interface KeyHintPair {
		/** The literal key glyph or chord this pair names, e.g. `"j"` or `"\u2191\u2193"`. */
		key: string;
		/** The verb it performs, already localized. */
		label: string;
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils/cn.js';

	/**
	 * T5 (round fifteen, docs/design/DECISIONS.md), issue #432: one key beside one verb, as a
	 * row of pairs. Three call sites each drew a keyboard hint their own way -
	 * `InlineProposalReview` printed five bare `kbd`s and then one joined phrase
	 * ("muovi, accetta, rifiuta, annulla"), asking the reader to zip two lists together;
	 * `ProposalQueue` drew a near-identical version; `CommandPalette`'s footer used no
	 * `kbd` at all. This is the one shape all three use now.
	 *
	 * G3 = B stays: whether a key is bare or carries a modifier is the caller's decision
	 * (`$lib/keys.ts` remains the vocabulary) - this component only pairs a key with its
	 * verb and lays the pairs out in a row.
	 *
	 * Not interactive: real `<kbd>` elements, no `role="button"`, nothing to focus or
	 * announce as a control. Hidden below `sm` unconditionally - a phone has no keyboard
	 * to hint at (#148), and every call site already hid its own version there.
	 */
	let { pairs, class: className }: { pairs: KeyHintPair[]; class?: string } = $props();
</script>

<div class={cn('hidden flex-wrap items-center gap-3 text-label text-muted sm:flex', className)}>
	{#each pairs as pair, i (i)}
		<span class="flex items-center gap-1.5">
			<kbd class="rounded border border-line-2 px-1 font-mono">{pair.key}</kbd>
			{pair.label}
		</span>
	{/each}
</div>
