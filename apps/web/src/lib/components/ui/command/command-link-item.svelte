<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CommandPrimitive.LinkItemProps = $props();
</script>

<!-- #147: bg-accent-bg/text-accent-ink, not the generic accent alias - see the doc
     comment on dropdown-menu-item.svelte's own hover class. -->
<CommandPrimitive.LinkItem
	bind:ref
	data-slot="command-item"
	class={cn(
		"relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none aria-selected:bg-accent-bg aria-selected:text-accent-ink data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</CommandPrimitive.LinkItem>
