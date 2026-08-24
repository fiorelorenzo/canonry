<script lang="ts">
	/**
	 * V9 (round seventeen, docs/design/DECISIONS.md, #501): the micro-interaction group's
	 * "accept mark drawing itself" - a checkmark whose stroke draws in once, for the
	 * moment a control confirms a choice (a style preset picked, a proposal accepted),
	 * rather than a mark that is simply there on the next paint. Lucide's `check` path
	 * (`M20 6 9 17l-5-5`) is two segments summing to about 22.6 user units inside the
	 * icon's own 24x24 viewBox; 24 gives the dash a hair of slack rather than clipping
	 * the stroke's rounded cap.
	 *
	 * Runs on duration-move, per docs/ux/MOTION.md rule 1: a stroke drawing across is a
	 * position change, not a colour one. Nothing here reads the reduced-motion media
	 * query itself - `--transition-duration-move` already collapses to 1ms under it
	 * (layout.css), so the draw simply completes at once instead of needing a second,
	 * component-local rule to suppress it.
	 */
	import CheckIcon from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils/cn.js';
	import type { IconProps } from '@lucide/svelte';

	let { class: className, ...restProps }: IconProps = $props();
</script>

<CheckIcon aria-hidden="true" class={cn('accept-mark', className)} {...restProps} />

<style>
	/* `:global` because the class lands on the `<svg>` `CheckIcon` (a child component)
	   renders, and Svelte's scoping hash is never added to another component's own
	   output - a plain `.accept-mark` selector here would silently never match. */
	:global(.accept-mark) {
		stroke-dasharray: 24;
		stroke-dashoffset: 24;
		animation: accept-mark-draw var(--transition-duration-move) var(--ease-arrive) forwards;
	}

	@keyframes accept-mark-draw {
		to {
			stroke-dashoffset: 0;
		}
	}
</style>
