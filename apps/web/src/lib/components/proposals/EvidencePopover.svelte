<script lang="ts">
	/**
	 * C5 = B: a dotted underline marks where evidence exists; click opens a floating box
	 * with the quoted source and a plain-word reason. A `caveat` renders it already open,
	 * un-closeable, and names the weakness at the top - the guardrail-3 case where the
	 * only evidence is embedding similarity, or the GM's own request in Ask (issue #270),
	 * which must never be the one thing a skimming GM clicks past.
	 *
	 * Round sixteen U9 (#454): this popover carried C1's copilot hue behind a trigger that
	 * said `Prova`, the code's own name for itself rather than what a reader needs.
	 * Neither survives. The trigger now says what it opens (`t.button`), the quote reads
	 * as a quote (the app's own blockquote treatment - `border-line-2`, italic, the way
	 * `EntryProse.svelte` already renders a real one), and the relation or mention behind
	 * it reads as provenance - small, monospace, set apart from the prose - all on tokens
	 * that carry no hue at all.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import type { EvidenceCaveat, EvidenceReason, EvidenceView } from './evidence';

	let {
		views,
		caveat,
		locale
	}: {
		views: EvidenceView[];
		caveat: EvidenceCaveat | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).proposals.evidence);

	let forceOpen = $derived(caveat !== null);
	let open = $state(caveat !== null);

	// `reason` never carries English words (see evidence.ts's own doc comment) - this is
	// the one place a structured reason becomes the sentence a GM actually reads.
	function reasonText(reason: EvidenceReason): string {
		switch (reason.kind) {
			case 'relation':
				return t.reasonRelation(reason.path.join(' \u2192 '), reason.hops);
			case 'mention':
				return t.reasonMention(reason.direction, reason.matchedText);
			case 'embedding':
				return t.reasonEmbedding;
			case 'instruction':
				return t.reasonInstruction;
			case 'importAmbiguous':
				return t.reasonImportAmbiguous(reason.path, reason.count);
			case 'importMatched':
				return t.reasonImportMatched(reason.path);
			case 'importExtracted':
				return t.reasonImportExtracted(reason.path);
		}
	}
</script>

{#if views.length > 0}
	<span class="evidence relative inline-block" class:forced={forceOpen}>
		<button
			type="button"
			class="ev inline items-center gap-1 text-ink underline decoration-dotted underline-offset-2"
			aria-expanded={open}
			disabled={forceOpen}
			onclick={() => (open = !open)}
		>
			{t.button}
		</button>
		{#if open}
			<!-- Issue #345: below `sm` the floating box is 288px anchored to a word that can sit
			     anywhere on the line, so it hung 40px past the right edge and over the Accept
			     button - measured at 390px on the plan queue, and the same box now renders on
			     the entry itself, where a forced-open caveat (guardrail 3) is unmissable and
			     therefore unmissably in the way. On a phone it stops floating and takes its own
			     line under the sentence instead. -->
			<span
				class="pop z-10 mt-1 w-72 rounded-md border border-line-2 bg-panel p-3 text-xs shadow-lg max-sm:mt-2 max-sm:block max-sm:w-full sm:absolute sm:top-full sm:left-0"
			>
				{#if caveat !== null}
					<span
						class="mb-1.5 block rounded-sm bg-warn-bg px-1.5 py-1 font-mono text-[10px] font-bold tracking-wide text-warn uppercase"
					>
						{caveat === 'instructionOnly' ? t.instructionOnly : t.embeddingOnly}
					</span>
				{/if}
				{#each views as view, i (i)}
					<span class="mb-2 block last:mb-0">
						{#if view.quote}
							<span class="mb-1 block border-l-2 border-line-2 pl-2 text-ink-2 italic"
								>&ldquo;{view.quote}&rdquo;</span
							>
						{/if}
						<span class="block font-mono text-[11px] text-muted">{reasonText(view.reason)}</span>
					</span>
				{/each}
				{#if !forceOpen}
					<button
						type="button"
						class="mt-1 text-[11px] text-muted underline"
						onclick={() => (open = false)}
					>
						{t.close}
					</button>
				{/if}
			</span>
		{/if}
	</span>
{/if}

<style>
	.ev {
		cursor: pointer;
		font: inherit;
		background: none;
		padding: 0;
	}
	.ev:disabled {
		cursor: default;
	}
</style>
