<script lang="ts">
	/**
	 * Canonry's mark (decision H2 = C, "the tie"): two entries and the link
	 * between them, drawn so the link is also the C. Change one entry and it
	 * touches the other, which is the one thing this product does that nothing
	 * else does. Geometry lives here once - every surface that needs the mark
	 * imports this component rather than pasting the SVG. Locked geometry (Main,
	 * after the original brief's tighter arc closed its aperture and read as a
	 * blob at every size): arc radius 21, nodes 40 apart, inline stroke-width 8 -
	 * the favicon file itself goes heavier (8.5) and the small rasters heavier
	 * still, because a 16px icon needs weight a page-scale mark does not.
	 *
	 * `currentColor` for both stroke and fill, always: the mark inherits
	 * whatever ink/accent token the surrounding text already sits in, and never
	 * a hardcoded hex (C1 - it must never be able to pick up the copilot's
	 * own hue by accident).
	 *
	 * `aria-hidden` by default, because every current use sits right beside the
	 * wordmark or the product name - a screen reader should hear "Canonry" once,
	 * not twice. Pass `label` for the rare case where the mark stands alone with
	 * no adjacent text, which swaps it to `role="img"` with that label instead.
	 */
	let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<svg
	viewBox="0 0 64 64"
	width={size}
	height={size}
	focusable="false"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<path
		d="M46 12a21 21 0 1 0 0 40"
		fill="none"
		stroke="currentColor"
		stroke-width="8"
		stroke-linecap="round"
	/>
	<circle cx="46" cy="12" r="7" fill="currentColor" />
	<circle cx="46" cy="52" r="7" fill="currentColor" />
</svg>
