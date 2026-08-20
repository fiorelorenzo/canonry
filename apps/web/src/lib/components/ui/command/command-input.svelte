<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Command as CommandPrimitive } from 'bits-ui';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { cn } from '$lib/utils/cn.js';

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(''),
		/** #416 (S11): the docked composer drops the leading search icon and this
		 * component's own translucent palette chrome, and gains a trailing control - a
		 * send button, where the dialog placement has nothing. Both default to the
		 * dialog's own look, so `CommandPalette.svelte`'s dialog placement renders
		 * exactly as it did before this issue. */
		showSearchIcon = true,
		groupClass,
		trailing,
		...restProps
	}: CommandPrimitive.InputProps & {
		showSearchIcon?: boolean;
		groupClass?: string;
		trailing?: Snippet;
	} = $props();
</script>

<div data-slot="command-input-wrapper" class="p-1 pb-0">
	<InputGroup.Root
		class={cn(
			'h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!',
			groupClass
		)}
	>
		<CommandPrimitive.Input
			{value}
			data-slot="command-input"
			class={cn(
				'w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
				className
			)}
			{...restProps}
		>
			{#snippet child({ props })}
				<InputGroup.Input {...props} bind:value bind:ref />
			{/snippet}
		</CommandPrimitive.Input>
		{#if showSearchIcon}
			<InputGroup.Addon>
				<SearchIcon class="size-4 shrink-0 opacity-50" />
			</InputGroup.Addon>
		{/if}
		{#if trailing}
			<InputGroup.Addon align="inline-end">
				{@render trailing()}
			</InputGroup.Addon>
		{/if}
	</InputGroup.Root>
</div>
