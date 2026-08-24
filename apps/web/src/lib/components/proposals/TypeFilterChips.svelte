<script lang="ts">
	/**
	 * D4 = B (docs/design/DECISIONS.md): "one queue in C6's vocabulary, with type filters".
	 * This is the whole of D4's addition to C6's `ProposalQueue.svelte` - a chip per
	 * entity type (plus "All") that narrows which candidates the queue below shows.
	 *
	 * Issue #498 (V2 = A): the bulk "Reject N shown" chip-context action this component
	 * used to grow beside the filter row is gone. Guardrail 1's tightened wording draws
	 * the line at "no bulk control anywhere on the page, not behind a dialog and not for
	 * a group" - a filtered bulk reject was exactly that, even though it never touched an
	 * accept. This file is a pure filter row now: pick a type, narrow what the queue
	 * shows, nothing else.
	 *
	 * `buckets` is the parent's `data.buckets` prop, so it stays reactive across a full
	 * page-data refresh (an accepted/rejected count updates in place) without this
	 * component owning any candidate state itself - `ProposalQueue` already owns that.
	 * Bucket `label`s arrive already localized (`computeFilterBuckets`'s own `locale`
	 * argument).
	 *
	 * #732: the selected chip is `aria-current="true"`, which is the value the repo already
	 * spells for an in-place button that marks the current one of a set (`TableDeck.svelte`
	 * twice, `ShellUserRow.svelte` for the chosen locale). Not `"page"`, since nothing here
	 * navigates: filtering is client state and the URL never changes, so #731's sibling
	 * question about pages does not arise. And not `aria-pressed`, which says "this button
	 * is pressed" and understates a single-select row where exactly one chip is current.
	 * Found by #732's sweep rather than named in the issue: it paints the selected chip
	 * (`bg-ink` with `text-panel`, the same look as the entries chips) and announced nothing,
	 * which made it the only filter row in the app whose state was invisible to a reader.
	 */
	import type { FilterBucket } from './importFilter';

	let {
		buckets,
		selected,
		onSelect
	}: {
		buckets: FilterBucket[];
		selected: string | null;
		onSelect: (type: string | null) => void;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each buckets as bucket (bucket.type ?? '__all__')}
		<button
			type="button"
			class="rounded-full border px-3 py-1 font-mono text-label"
			class:border-ink={bucket.type === selected}
			class:bg-ink={bucket.type === selected}
			class:text-panel={bucket.type === selected}
			class:border-line-2={bucket.type !== selected}
			class:text-ink-2={bucket.type !== selected}
			aria-current={bucket.type === selected ? 'true' : undefined}
			onclick={() => onSelect(bucket.type)}
		>
			{bucket.label}
			{bucket.total}
		</button>
	{/each}
</div>
