<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CommandPrimitive.ListProps = $props();
</script>

<!-- `CommandPrimitive.Input`'s combobox `aria-controls` reads `root.viewportNode`, which
     only a mounted `Viewport` (a distinct primitive from `List` itself) ever sets - axe:
     "Required ARIA attribute not present" on every consumer of this wrapper otherwise,
     the palette dialog and #381's docked composer both included. Wrapping the content
     here rather than exporting `Viewport` as a fourth public `Command.*` piece keeps the
     fix to the one place every consumer already goes through. -->
<CommandPrimitive.List
	bind:ref
	data-slot="command-list"
	class={cn(
		'no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none',
		className
	)}
	{...restProps}
>
	<CommandPrimitive.Viewport>
		{@render children?.()}
	</CommandPrimitive.Viewport>
</CommandPrimitive.List>
