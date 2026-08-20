<script lang="ts">
	/**
	 * Issue #383, decision R8 (docs/ux/DECISIONS.md, "Round thirteen"): the GM/player
	 * view used to be a label beside a button whose text changed - "a switch written
	 * the long way". R8 is explicit that this call site is not an O4 = B case at all:
	 * it is not choosing a value out of a list, it is turning one lens on, so it does
	 * not belong to `ui/segmented` (O4's binary/ternary shape) or `ui/select` (O4's
	 * vocabulary shape). It gets its own primitive instead, worth having once here
	 * rather than five times at call sites.
	 *
	 * Vendored the way `ui/select` was: bits-ui's `Switch` already carries the platform
	 * contract this needs - `role="switch"`, `aria-checked` rather than `aria-pressed`,
	 * and Space and Enter both toggle it (bits-ui's `SwitchRootState#onkeydown`) - so
	 * nothing here reimplements keyboard handling.
	 *
	 * G1: reading-room tokens only, so both palettes are this same markup - `bg-primary`
	 * (checked) and `bg-input` (unchecked) already resolve per `[data-theme='dark']`
	 * with no `dark:` prefix needed, the same alias vocabulary `ui/select` uses. The
	 * thumb's slide is the round twelve motion tokens (Q6, #367): `duration-move` and
	 * `ease-arrive`, because it moves position and reduced motion is meant to collapse
	 * it to 1ms rather than remove the state change outright.
	 */
	import { Switch as SwitchPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: SwitchPrimitive.RootProps = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	class={cn(
		'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors duration-fade outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background shadow-xs ring-0 transition-transform duration-move ease-arrive data-[state=checked]:translate-x-[18px]"
	/>
</SwitchPrimitive.Root>
