<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.OverlayProps = $props();
</script>

<!-- #147: bg-ink/40, matching dialog-overlay.svelte's own fix - see its doc comment. -->
<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn('fixed inset-0 z-50 bg-ink/40 supports-backdrop-filter:backdrop-blur-xs', className)}
	{...restProps}
/>
