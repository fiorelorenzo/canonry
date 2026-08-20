<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<!-- #147: bg-ink/40, matching the scrim GenerateDialog.svelte's own <dialog> used to
     carry by hand (backdrop:bg-ink/40) before round thirteen R2 (#377) moved it here -
     not a raw color, ink already flips with the palette. -->
<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn(
		'fixed inset-0 isolate z-50 bg-ink/40 duration-fade ease-arrive supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:ease-leave data-closed:fade-out-0',
		className
	)}
	{...restProps}
/>
