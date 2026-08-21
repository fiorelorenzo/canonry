<script lang="ts">
	/**
	 * Issue #497, decision V11 = C (docs/ux/DECISIONS.md, "round seventeen"): a thin bar
	 * on the accent, at the top of the shell's own scroll container, driven by
	 * `$app/state`'s `navigating` - the current Svelte 5 runes API, not the deprecated
	 * `$app/stores` version this app otherwise avoids. One place in the code: mounted
	 * once by `AppShell.svelte`, inside `main`, so every route present and future gets
	 * it for free.
	 *
	 * Delayed 150ms so a navigation that resolves before a reader could register it
	 * never flashes - `navigating.to` going back to `null` before the timer fires
	 * cancels it outright, and the bar is never shown at all for an instant swap.
	 *
	 * The growth and the fade are two separate transitions on purpose, each on its own
	 * MOTION.md token. The outer element's opacity runs on `duration-fade` and is left
	 * alone under `prefers-reduced-motion` (rule 1: a cross-fade moves nothing). The
	 * inner element's `scaleX` runs on `duration-move`, which layout.css's reduced-
	 * motion block collapses to 1ms because `transition-transform` is one of the three
	 * classes it targets - so the bar cannot travel under that preference, it can only
	 * appear and disappear. `scaleX` rather than `width`: a transform is what
	 * `transition-transform` actually covers, and it is the classic ".transition-all
	 * would also work but then opacity and scale could never carry different tokens"
	 * problem `.transition-opacity`/`.transition-transform` on two nested elements
	 * avoids - Tailwind's `transition-property` utilities do not compose on one
	 * element, they replace each other.
	 */
	import { navigating } from '$app/state';

	let shown = $state(false);
	let complete = $state(false);
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (navigating.to) {
			clearTimeout(resetTimer);
			showTimer = setTimeout(() => {
				complete = false;
				shown = true;
			}, 150);
		} else {
			clearTimeout(showTimer);
			if (shown) {
				// Snap to full width, then fade the whole bar out - `resetTimer`'s second leg
				// only clears `complete` once the fade has actually had time to finish
				// (duration-fade's own 140ms), so the next navigation's growth starts from a
				// genuinely invisible 0 rather than visibly snapping back from full width.
				complete = true;
				shown = false;
				resetTimer = setTimeout(() => {
					complete = false;
				}, 140);
			}
		}
		return () => clearTimeout(showTimer);
	});
</script>

<!-- Negative margins undo `main`'s own `px-4 pt-4 md:px-8 md:pt-8` gutters (AppShell.svelte)
     so the bar spans the true top edge of the scroll container flush, the way a page loader
     reads, rather than sitting indented inside the content padding. -->
<div class="sticky top-0 z-40 -mx-4 -mt-4 h-0 md:-mx-8 md:-mt-8" aria-hidden="true">
	<div
		class="h-0.5 w-full transition-opacity duration-fade ease-arrive"
		style:opacity={shown ? 1 : 0}
	>
		<div
			class="h-full w-full origin-left bg-accent transition-transform duration-move ease-arrive"
			style:transform={complete ? 'scaleX(1)' : 'scaleX(0.7)'}
		></div>
	</div>
</div>
