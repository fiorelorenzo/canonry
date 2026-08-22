<script lang="ts" module>
	/**
	 * #551: the one inline-link shape, so `underline decoration-line-2
	 * underline-offset-2` stops getting typed by hand at every call site (#469, #479's
	 * aside, #506 and #544's neighbourhood all wrote it themselves, four issues running
	 * the same three classes one file at a time). Underline is always on, never
	 * hover-only - a link a reader can only tell apart on hover fails the
	 * accessibility floor #493 set, because colour alone (`text-accent-ink`) is not a
	 * second cue.
	 *
	 * For a link inside running text: a sentence, a list row's inline mention, a
	 * one-line call to action. Not for a navigation row, a card surface, or a control
	 * that only looks like a link - those keep whatever shape they already have and
	 * never gain this underline (`EntryTable.svelte`'s row link, `AuditFlagsPanel`'s
	 * card-title link and `GenerateDialog`'s "Edit style" `<button>` are the three call
	 * sites #551 found and left alone on exactly that ground).
	 *
	 * `docs-prose` is the other exception: `DocPage.svelte`'s own `[&_a]:` rule already
	 * gives every link inside a doc's rendered markdown this same shape, so a link
	 * there stays outside this component rather than doubling the decoration.
	 */
	import { cn, type WithElementRef } from '$lib/utils/cn.js';
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	export type InlineLinkProps = Omit<WithElementRef<HTMLAnchorAttributes>, 'href'> & {
		href: string;
	};
</script>

<script lang="ts">
	let {
		ref = $bindable(null),
		class: className,
		href,
		children,
		...restProps
	}: InlineLinkProps = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- generic like the button:
     `href` is whatever a caller passed, and every call site resolves its own path. -->
<a
	bind:this={ref}
	data-slot="inline-link"
	{href}
	class={cn(
		'text-accent-ink underline decoration-line-2 underline-offset-2 hover:bg-accent-bg',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
