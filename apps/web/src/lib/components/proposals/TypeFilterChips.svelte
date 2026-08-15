<script lang="ts">
	/**
	 * D4 = B (docs/ux/DECISIONS.md): "one queue in C6's vocabulary, with type filters".
	 * This is the whole of D4's addition to C6's already-verified `ProposalQueue.svelte` -
	 * a chip per entity type (plus "All") that narrows which candidates the queue below
	 * operates on, and the one bulk action D4 grants beyond C6's per-entry accept/reject:
	 * "a chip's context menu offers 'Reject all N shown' whenever a filter is active"
	 * (docs/ux/d4-import-review.html, "What I would take"). Never an accept - guardrail 1
	 * forbids a bulk accept outright, and the same page's "Rejected outright" section names
	 * "Accept selected" as the specific shape to refuse.
	 *
	 * `buckets` is the parent's `data.buckets` prop, so it stays reactive across a full
	 * page-data refresh (an accepted/rejected count updates in place) without this
	 * component owning any candidate state itself - `ProposalQueue` already owns that.
	 * Bucket `label`s arrive already localized (`computeFilterBuckets`'s own `locale`
	 * argument); `locale` here only drives this component's own bulk-reject strings.
	 */
	import { enhance } from '$app/forms';
	import { messages, type Locale } from '$lib/i18n';
	import type { FilterBucket } from './importFilter';

	let {
		buckets,
		selected,
		onSelect,
		onRejectedFiltered,
		locale
	}: {
		buckets: FilterBucket[];
		selected: string | null;
		onSelect: (type: string | null) => void;
		/** Fires once the server confirms a filtered bulk reject, so the page can force the
		 * queue below to remount against the (now smaller) filtered set. */
		onRejectedFiltered?: (type: string, count: number) => void;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale).proposals.bulkReject);

	let rejecting = $state(false);
	let lastRejected = $state<{ type: string; count: number } | null>(null);

	let activeBucket = $derived(buckets.find((b) => b.type === selected) ?? null);
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each buckets as bucket (bucket.type ?? '__all__')}
		<button
			type="button"
			class="rounded-full border px-3 py-1 font-mono text-xs"
			class:border-ink={bucket.type === selected}
			class:bg-ink={bucket.type === selected}
			class:text-panel={bucket.type === selected}
			class:border-line-2={bucket.type !== selected}
			class:text-ink-2={bucket.type !== selected}
			onclick={() => onSelect(bucket.type)}
		>
			{bucket.label}
			{bucket.total}
		</button>
	{/each}

	{#if selected !== null && activeBucket && activeBucket.pending > 0}
		<form
			method="POST"
			action="?/rejectFiltered"
			use:enhance={() => {
				rejecting = true;
				lastRejected = null;
				return async ({ result, update }) => {
					rejecting = false;
					// `update()` first: it re-runs the page load, refreshing `data.candidates` -
					// only once that has landed is it safe to bump `remountNonce` (the caller's
					// forced-remount signal), or the newly-mounted queue would just read the same
					// stale (still-pending) candidates it had a moment ago.
					await update();
					if (result.type === 'success' && result.data) {
						const type = result.data.type as string;
						const count = result.data.count as number;
						lastRejected = { type, count };
						onRejectedFiltered?.(type, count);
					}
				};
			}}
		>
			<input type="hidden" name="type" value={activeBucket.type} />
			<button
				type="submit"
				disabled={rejecting}
				class="rounded-md border border-danger px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg disabled:opacity-50"
			>
				{rejecting ? t.rejecting : t.rejectShown(activeBucket.pending)}
			</button>
		</form>
	{/if}

	{#if lastRejected}
		<span class="text-xs text-muted">{t.rejectedCount(lastRejected.count)}</span>
	{/if}
</div>
