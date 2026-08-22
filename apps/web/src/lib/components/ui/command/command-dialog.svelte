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

<!-- Issue #525: `Dialog.Header`/`Title`/`Description` used to sit as a sibling of
     `Dialog.Content`, both direct children of `Dialog.Root` - a plain provider with no
     DOM node of its own - so the sr-only header rendered wherever this component
     mounts in the tree (always, since the palette is always mounted for mod+K)
     rather than inside the dialog's own `role="dialog"` surface, which is the one
     element axe's `region` rule does not require to sit inside a landmark. Nesting it
     inside `Dialog.Content` matches the vendored gallery's own reference usage
     (`routes/dev/ui/+page.svelte`) and changes nothing about naming: bits-ui wires
     `Dialog.Content`'s `aria-labelledby`/`aria-describedby` off `Title`/`Description`
     through `Dialog.Root`'s own shared state, which tracks component-tree
     descendants rather than DOM position, so the accessible name and description were
     never broken - only where the text nodes themselves lived in the tree. -->
<Dialog.Root bind:open {...restProps}>
	<Dialog.Content
		class={cn('top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0', className)}
		{showCloseButton}
		{closeLabel}
		{portalProps}
	>
		<Dialog.Header class="sr-only">
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Command {...restProps} bind:value bind:ref {children} />
	</Dialog.Content>
</Dialog.Root>
