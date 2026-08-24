<script lang="ts" module>
	/**
	 * #652: the one horizontal scroll container a table sits in, and the reason it is a
	 * component rather than three classes typed by hand is the word `relative`.
	 *
	 * `/admin/models` was the only route in the app that scrolled the whole document
	 * sideways, 175px at 390 and 69px at 768, and its tables were already wrapped in
	 * `overflow-x-auto`, so the scroll container was never the missing piece. What
	 * escaped it was the `<span class="sr-only">` naming each table's actions column:
	 * `sr-only` is `position: absolute`, the wrapper was not a containing block, so the
	 * span's containing block was the initial one and its box landed at the table's
	 * un-scrolled right edge, 565px into a 390px viewport. An absolutely positioned
	 * element is only clipped by a scroll container that is in its containing block
	 * chain, so the span was not clipped and the root's scrollable overflow grew to
	 * reach it. Measured: `documentElement.scrollWidth` 565, `span.offsetParent` BODY;
	 * with `position: relative` on the wrapper, 390 and the wrapper itself.
	 *
	 * That makes it a property of the container rather than of the table or of the
	 * span, and it applies to anything absolutely positioned inside one of these: a
	 * popover, a focus ring, a badge. So the container is spelled once here and
	 * `routes/horizontal-scroll-container.test.ts` fails if any other element in the app
	 * scrolls horizontally without also being a containing block.
	 *
	 * The width behaviour is unchanged and deliberate: at 390 the models table is 528px
	 * wide inside a 292px box and it scrolls inside the page. V1's `wide` is the
	 * declared width for the admin surfaces and V3 has just made the type scale mean
	 * something, so shrinking the type or hiding columns to fit a phone was refused.
	 */
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn.js';
</script>

<script lang="ts">
	let {
		class: className,
		children
	}: {
		/** Spacing the call site owns (a `mt-*`), never the overflow or the position. */
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div
	data-slot="table-scroll"
	class={cn('relative overflow-x-auto rounded-lg border border-line', className)}
>
	{@render children()}
</div>
