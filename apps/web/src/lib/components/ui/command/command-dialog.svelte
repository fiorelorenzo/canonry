<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils/cn.js';
	import Command from './command.svelte';
	import type { Command as CommandPrimitive, Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		ref = $bindable(null),
		value = $bindable(''),
		title,
		description,
		showCloseButton = false,
		closeLabel,
		portalProps,
		children,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.RootProps> &
		WithoutChildrenOrChild<CommandPrimitive.RootProps> & {
			portalProps?: DialogPrimitive.PortalProps;
			children: Snippet;
			/** #147: sr-only Dialog.Title/Description text - required, no English
			 * default, so whatever calls this always supplies its own catalogue
			 * strings (wave two's command palette, #149, first). */
			title: string;
			description: string;
			showCloseButton?: boolean;
			/** Forwarded to Dialog.Content, which needs it whenever showCloseButton
			 * is true - see that component's own doc comment. */
			closeLabel: string;
			class?: string;
		} = $props();
</script>

<Dialog.Root bind:open {...restProps}>
	<Dialog.Header class="sr-only">
		<Dialog.Title>{title}</Dialog.Title>
		<Dialog.Description>{description}</Dialog.Description>
	</Dialog.Header>
	<Dialog.Content
		class={cn('top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0', className)}
		{showCloseButton}
		{closeLabel}
		{portalProps}
	>
		<Command {...restProps} bind:value bind:ref {children} />
	</Dialog.Content>
</Dialog.Root>
