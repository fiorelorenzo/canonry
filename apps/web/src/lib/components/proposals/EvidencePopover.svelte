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
	 *
	 * Round seventeen (#472): the forced-open box floated past `sm` (issue #345 only ever
	 * fixed the phone width), landing on top of whatever it was meant to explain -
	 * guardrail 3 asks for evidence a reader can judge, and evidence that hides the change
	 * it backs fails that at the first read. Forced-open now takes the phone's own
	 * treatment (`block`, full width, under the line) at every width instead of only below
	 * `sm`, so it never has anything left to cover; the hand-opened box keeps floating,
	 * unchanged. That box also gained what a hand-rolled disclosure needs and never had -
	 * Escape closes it and hands focus back to the trigger, the same pattern
	 * `UniverseSwitcher.svelte` already uses (`isDismissKey`, a `close()` that flips `open`
	 * and refocuses) - guarded to do nothing while `forceOpen` is true, which stays exactly
	 * as un-closeable as this comment's first paragraph already says.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { isDismissKey } from '$lib/keys';
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
	let triggerEl: HTMLButtonElement | undefined = $state();

	/** Closes the hand-opened box and hands the keyboard back to the word that opened it,
	 * so dismissing it never strands focus on a node the `{#if}` just removed. Never
	 * called while `forceOpen` is true - see `onWindowKeydown` below - so a forced-open
	 * caveat stays un-closeable. */
	function close(): void {
		open = false;
		triggerEl?.focus();
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (open && !forceOpen && isDismissKey(event)) close();
	}

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

	/** Issue #472: a forced-open caveat never floats, at any width - it takes its own
	 * line under the sentence, the way issue #345 already had it doing below `sm`. The
	 * hand-opened box is untouched: still `w-72`, still anchored to the trigger, still
	 * absolute at `sm` and up. */
	let popClass = $derived(
		forceOpen
			? 'pop z-10 mt-2 block w-full rounded-md border border-line-2 bg-panel p-3 text-label shadow-elevated'
			: 'pop z-10 mt-1 w-72 rounded-md border border-line-2 bg-panel p-3 text-label shadow-elevated max-sm:mt-2 max-sm:block max-sm:w-full sm:absolute sm:top-full sm:left-0'
	);
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if views.length > 0}
	<span class="evidence relative inline-block" class:forced={forceOpen}>
		<button
			bind:this={triggerEl}
			type="button"
			class="ev inline items-center gap-1 text-ink underline decoration-dotted underline-offset-2"
			aria-expanded={open}
			disabled={forceOpen}
			onclick={() => (open = !open)}
		>
			{t.button}
		</button>
		{#if open}
			<!-- Issue #345 fixed this below `sm`; issue #472 makes it the only shape the
			     forced-open box has, at every width, rather than only the phone's. A
			     forced-open caveat (guardrail 3) is the evidence for a change a reader
			     cannot yet judge, so it cannot be allowed to sit over that change - it
			     takes its own line under the sentence instead of floating past the text
			     column, exactly the way this already worked below `sm`. The hand-opened
			     box is unchanged: still a floating box below `sm` and up, anchored to
			     whichever word on the line happened to hold it. -->
			<span class={popClass}>
				{#if caveat !== null}
					<span
						class="mb-1.5 block rounded-sm bg-warn-bg px-1.5 py-1 font-mono text-label font-bold tracking-wide text-warn uppercase"
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
						<span class="block font-mono text-label text-muted">{reasonText(view.reason)}</span>
					</span>
				{/each}
				{#if !forceOpen}
					<button type="button" class="mt-1 text-label text-muted underline" onclick={close}>
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
