<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import PageBand from './page-band.svelte';
	import { PAGE_WIDTH_CLASS, type PageWidth } from './page-width';

	/**
	 * One page: the V1 band and the V1 body, with one `width` between them.
	 *
	 * Round seventeen V1 = B (#494) shipped these as two components a route rendered as
	 * siblings, `PageHeader` and `PageBody`, on the rule that "a page's width choice is a
	 * decision about its body; it was never allowed to move the band". Round twenty
	 * X1 = A (#598) reverses that half of V1: the band is a header over the column, not a
	 * full-width frame, so it takes the width the body declares. What V1's structural
	 * guarantee was actually about survives unchanged, because it was never about the
	 * band ignoring the width - it was about no page drawing its own title. No page draws
	 * one here either.
	 *
	 * The two collapsed rather than both taking a `width` prop, which was the other shape
	 * X1's artifact drew. Both are the same thirty-one files; only one of them leaves a
	 * route unable to contradict itself, and the independence between the two components
	 * is exactly what produced the 336px in the first place. The cost is real and taken:
	 * `PageHeader` and `PageBody` no longer move separately.
	 *
	 * `bodyClass` is the one escape and it is not a width. `PageBody` never had a defined
	 * height, which is why two routes applied the width token to their own element instead
	 * of using it: the entry editor needs an unbroken `h-full` chain from `main` down to
	 * `MarkdownEditor`'s `fill`, and an auto-height wrapper in the middle of that chain
	 * breaks it. Those routes now pass their layout classes here rather than declaring the
	 * width a second time. A `max-w-` in this prop would reopen the thing X1 closed, so
	 * `page-header-offset.test.ts` asserts that no route file spells one at all.
	 */
	let {
		width,
		title,
		eyebrow,
		description,
		actions,
		filters,
		titleAdornment,
		bodyClass,
		children
	}: {
		width: PageWidth;
		title: string;
		eyebrow?: string;
		description?: string;
		actions?: Snippet;
		filters?: Snippet;
		titleAdornment?: Snippet;
		/** Layout classes the body wrapper needs (a height or flex chain), never a width. */
		bodyClass?: string;
		children: Snippet;
	} = $props();
</script>

<PageBand {width} {title} {eyebrow} {description} {actions} {filters} {titleAdornment} />

<div data-page-body class={cn(PAGE_WIDTH_CLASS[width], bodyClass)}>{@render children()}</div>
