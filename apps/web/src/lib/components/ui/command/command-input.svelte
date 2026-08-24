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
		/** Round eighteen, issue #531 (W3 = B): the docked Ask composer's own box
		 * grows with a long question instead of staying one line, on the same
		 * `field-sizing: content` `Textarea` the rest of the product already uses for
		 * this (`QuickNoteForm.svelte`, the settings prompt fields), capped rather
		 * than unbounded. `CommandPrimitive.Input` still owns the value and the
		 * combobox wiring either way - only the element its `child` snippet renders
		 * changes. Never set outside `placement="docked"`: a one-line combobox is
		 * still exactly right for a name or an action. */
		growing = false,
		...restProps
	}: CommandPrimitive.InputProps & {
		showSearchIcon?: boolean;
		groupClass?: string;
		trailing?: Snippet;
		growing?: boolean;
	} = $props();
</script>

<div data-slot="command-input-wrapper" class="p-1 pb-0">
	<InputGroup.Root
		class={cn(
			growing
				? 'h-auto! items-end rounded-lg! border-input/30 bg-field shadow-none! *:data-[slot=input-group-addon]:pb-1! *:data-[slot=input-group-addon]:pl-2!'
				: 'h-8! rounded-lg! border-input/30 bg-field shadow-none! *:data-[slot=input-group-addon]:pl-2!',
			groupClass
		)}
	>
		<CommandPrimitive.Input
			{value}
			data-slot="command-input"
			class={cn(
				'w-full text-body outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
				className
			)}
			{...restProps}
		>
			{#snippet child({ props })}
				{#if growing}
					<!-- ARIA-in-HTML disallows `role="combobox"` on a `<textarea>` (a
				     multi-line field cannot be a single-line combobox host) - axe's own
				     `aria-allowed-role` catches it the moment this renders. bits-ui's
				     `props` still sets it, meant for the dialog placement's `<input>`,
				     so the two attributes that only mean anything paired with that role
				     (`aria-expanded`, `aria-activedescendant`) are cleared here and
				     `role` falls back to the textarea's own correct implicit `textbox`.
				     `aria-controls`/`aria-autocomplete` stay: both are valid on a plain
				     textbox too, and are what still ties this box to the entity list
				     above it for anyone not reading the screen. -->
					<InputGroup.Textarea
						{...props}
						bind:value
						bind:ref
						rows={1}
						role={undefined}
						aria-expanded={undefined}
						aria-activedescendant={undefined}
						class={cn(props.class as string | undefined, 'max-h-40 min-h-8 resize-none py-1.5')}
					/>
				{:else}
					<InputGroup.Input {...props} bind:value bind:ref />
				{/if}
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
