<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Round seventeen V1 = B (#494, docs/ux/DECISIONS.md): the three named body widths,
	 * and no others. Every route below `PageHeader`'s band wraps its content in exactly
	 * one of these - "a page picking one of three is a decision somebody can review; a
	 * page picking `max-w-2xl` is a decision nobody made". The three branches render
	 * literal `max-w-reading` / `max-w-working` classes rather than an interpolated
	 * `max-w-{width}` on purpose: Tailwind only generates a utility for a class name it
	 * can find as a complete string in source, so a templated class name would silently
	 * produce no CSS at all.
	 *
	 * - reading (44rem, `--container-reading`): an entry, the docs, the privacy page,
	 *   the players' wiki. Long-form prose narrows further still, to
	 *   `--container-measure`, on its own inner element - that token is unchanged and
	 *   is not this one.
	 * - working (62rem, `--container-working`): the inbox, a plan, the settings panes,
	 *   the review routes.
	 * - wide: full bleed, no cap - the entries table, table mode, the admin surfaces.
	 */
	let {
		width,
		children
	}: {
		width: 'reading' | 'working' | 'wide';
		children: Snippet;
	} = $props();
</script>

{#if width === 'reading'}
	<div class="max-w-reading mx-auto w-full">{@render children()}</div>
{:else if width === 'working'}
	<div class="max-w-working mx-auto w-full">{@render children()}</div>
{:else}
	<div class="w-full">{@render children()}</div>
{/if}
