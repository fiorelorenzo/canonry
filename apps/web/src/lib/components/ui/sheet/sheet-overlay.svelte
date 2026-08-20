<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.OverlayProps = $props();
</script>

<!-- #147: bg-ink/40, matching dialog-overlay.svelte's own fix - see its doc comment.

     #367 (Q6): the scrim now fades, which it did not before. The sheet beside it always
     slid in over 200ms while this appeared at full strength on the first frame, so the
     panel arrived into a room that had already gone dark. Same four classes
     dialog-overlay.svelte carries, on the fade token, so reduced motion turns both of
     them into the same instant scrim rather than only one. -->
<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn(
		'fixed inset-0 z-50 bg-ink/40 duration-fade ease-arrive supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:ease-leave data-closed:fade-out-0',
		className
	)}
	{...restProps}
/>
