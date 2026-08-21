/**
 * Issue #438, decision T11: the shell reserves space for every fixed-position chrome
 * element that can sit over the bottom of the page, so `main` can carry the total as
 * padding and nothing real is ever left underneath one. Two publishers today - PhoneNav's
 * bottom tab bar (mobile, universe mode) and QuickAsk's own launcher/panel (closed pill,
 * open panel, whichever the `{#if quickAskState.open}` block currently mounts) - and one
 * reader, `AppShell.svelte`'s `main`.
 *
 * A measured value here rather than a CSS variable set once on the shell: the dock's
 * height is not a constant. The launcher is a fixed pill; the open panel grows with the
 * conversation up to `max-h-[70vh]`, and only a real measurement tracks that without
 * hardcoding a worst case that would over-reserve for a two-line answer and under-reserve
 * for nothing, since 70vh already is the worst case. Svelte's reactive module state is
 * already how `quickAskState` and `paletteState` cross this exact component boundary, so
 * this follows that pattern rather than introducing a `document.documentElement.style`
 * side channel a CSS variable would need to be pushed through by the same JS anyway.
 *
 * Each field is the *total* exclusion zone from the bottom of the viewport for its own
 * chrome - not the element's own height, its height plus however far its own `bottom-*`
 * offset already holds it off the edge - so `AppShell.svelte` only has to add the two
 * together, never reason about each one's own CSS positioning. Zero when nothing is
 * currently rendering that chrome (unmounted, or `hidden` at the current breakpoint) -
 * `measureDockElement` below is what keeps both promises.
 */
export const shellLayoutState = $state({
	phoneNavHeight: 0,
	dockHeight: 0
});

/**
 * A Svelte action: attach to the one element whose rendered bounding box should be
 * reserved as bottom padding elsewhere. Reports 0 while the element is not actually
 * visible (`display: none`, as `hidden md:flex` renders it below `md`) rather than the
 * `0,0` viewport-corner rect a hidden element's `getBoundingClientRect()` would otherwise
 * report - measuring that literally would ask `main` to reserve the entire viewport
 * height, which is worse than reserving nothing. `ResizeObserver` tracks the open panel
 * growing with the conversation; the `resize` listener tracks the `md` breakpoint moving
 * the same element between a phone offset and a desktop one without changing its own
 * size. Both call the same recompute, and the action's own teardown zeroes the field, so
 * navigating away (the element unmounting entirely) self-heals exactly like
 * `quick-ask-state.svelte.ts`'s own turn lookups do.
 */
export function measureDockElement(node: HTMLElement, onHeight: (heightPx: number) => void) {
	function recompute() {
		// Not `offsetParent === null`: a `position: fixed` element has no offset parent by
		// specification, so that test called every element this action exists to measure
		// hidden, `dockHeight` stayed 0 on every route, and the reserve reserved nothing.
		// Measured before the fix: the open panel still sat 59px over the editor's
		// textarea. A zero-height rect is what actually distinguishes "hidden at this
		// breakpoint" from "rendered", since `display: none` collapses the box.
		const rect = node.getBoundingClientRect();
		if (rect.height === 0 || rect.width === 0) {
			onHeight(0);
			return;
		}
		onHeight(Math.max(0, window.innerHeight - rect.top));
	}

	const observer = new ResizeObserver(recompute);
	observer.observe(node);
	window.addEventListener('resize', recompute);
	recompute();

	return {
		destroy() {
			observer.disconnect();
			window.removeEventListener('resize', recompute);
			onHeight(0);
		}
	};
}
