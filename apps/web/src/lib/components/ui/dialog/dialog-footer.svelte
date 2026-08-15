<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn, type WithElementRef } from '$lib/utils/cn.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		closeLabel,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		/** #147: optional close action alongside dialog-content's own X - omit to skip
		 * it, since there's no English default text to fall back to here either. */
		closeLabel?: string;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn('flex flex-col-reverse gap-2 gap-2 sm:flex-row sm:justify-end', className)}
	{...restProps}
>
	{@render children?.()}
	{#if closeLabel}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="secondary" {...props}>{closeLabel}</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
