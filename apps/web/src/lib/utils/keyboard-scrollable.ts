/**
 * #725: a container that scrolls horizontally has to be reachable from a keyboard, and
 * `tabindex="0"` is the whole mechanism, because a focused scroll container is scrolled by
 * the arrow keys, Home, End and the page keys with no code of ours involved.
 *
 * Three of the five tables `/admin/metrics` draws overflow at 390 and 768 with zero
 * focusable descendants, so nothing inside them could take focus and the columns past the
 * fold were unreachable without a pointer: axe `scrollable-region-focusable`, `serious`,
 * WCAG 2.1.1. This is an action rather than three attributes typed into each component for
 * the reason `TableScroll` itself exists: the wrapper was hand-written ten times before
 * #654 and one copy was missing a word.
 *
 * **It applies only while the element is actually overflowing**, measured rather than
 * assumed. Unconditional focusability would put a tab stop on every table at every width,
 * and measured at 1440 not one scroll container in this app overflows, so each of those
 * stops would be a keystroke that scrolls nothing on the width most admin work happens
 * at. `scrollWidth > clientWidth` is the only honest test, since whether a table overflows
 * depends on its data and not on a breakpoint that could be named in CSS.
 *
 * **It does not care whether the element already contains something focusable**, which is
 * where it is deliberately stricter than axe. axe passes any scroll container holding a
 * focusable descendant, and that is a much weaker guarantee than it reads as: measured on
 * `/admin/pricing` at 390, all 24, 36 and 3 focusables of its three tables sit in the
 * first column, the rightmost ending at x=173 of a 649px table, so 476px of that table
 * could not be brought into view by tabbing. Reaching a control is not scrolling. So
 * `/admin/models` and `/admin/pricing` get a real fix here for a defect axe never
 * reported on them.
 *
 * **The name is required**, because a focusable element that announces nothing is a stop a
 * screen reader user cannot place, and `aria-label` on a bare `div` is not reliably
 * exposed without a role: hence `role="group"`. Not `role="region"`, which is a landmark:
 * the `<section>` and heading around each of these already carry the page structure, and
 * landmarks that appear and disappear as the viewport changes are worse navigation than
 * none. Callers pass the heading they already render above the element, so this adds no
 * copy in either locale and the two strings cannot drift.
 */
export function keyboardScrollable(node: HTMLElement, label: string) {
	let current = label;

	function recompute() {
		// Keep the stop while it holds focus even once it no longer overflows: a resize
		// across the breakpoint would otherwise remove `tabindex` from the focused element
		// and drop the user's focus to `<body>`, losing their place. It goes away on the
		// next recompute after they tab out.
		const scrolls = node.scrollWidth > node.clientWidth || document.activeElement === node;
		if (scrolls) {
			node.setAttribute('tabindex', '0');
			node.setAttribute('role', 'group');
			node.setAttribute('aria-label', current);
		} else {
			node.removeAttribute('tabindex');
			node.removeAttribute('role');
			node.removeAttribute('aria-label');
		}
	}

	// The element's own box shrinks with the viewport, which is the common case. The
	// content's box changes without it when a table reflows its own columns, which
	// `EntryTable` does client-side as it filters and sorts, so the content is observed
	// too. `resize` on top of both catches a breakpoint moving a table between
	// `table-fixed` and `sm:table-auto`, where the layout algorithm changes and neither box
	// necessarily reports a new size.
	const observer = new ResizeObserver(recompute);
	observer.observe(node);
	if (node.firstElementChild) observer.observe(node.firstElementChild);
	window.addEventListener('resize', recompute);
	node.addEventListener('blur', recompute);
	recompute();

	return {
		update(next: string) {
			current = next;
			recompute();
		},
		destroy() {
			observer.disconnect();
			window.removeEventListener('resize', recompute);
			node.removeEventListener('blur', recompute);
		}
	};
}
