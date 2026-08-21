<script lang="ts" module>
	export type ComboboxOption = {
		value: string;
		label: string;
		/** A quiet trailing word: an entity's type, a session's date, a source's kind. */
		hint?: string;
		/** Extra words the search matches on without showing them. */
		keywords?: string[];
	};
</script>

<script lang="ts">
	/**
	 * Decision O4 = B (docs/ux/DECISIONS.md, "Round ten"), issue #286: a list drawn from
	 * the GM's own data gets a combobox with search. This is the third of the three
	 * controls, next to `ui/segmented` (a binary or ternary state) and `ui/select` (a
	 * vocabulary the product itself ships).
	 *
	 * It is the shadcn-svelte combobox recipe rather than anything new: a Popover whose
	 * content is a Command list, both already vendored under `ui/` by I9 = C, so the
	 * hard parts (focus trapping, the escape layer, roving selection, the filter) are
	 * bits-ui's rather than ours, and this adds no dependency. The reason this call site
	 * needs it at all is `settings/+page.svelte`'s precedence picker, which offers every
	 * entity in a derived universe with no filter of any kind: a plain listbox over two
	 * hundred entries is the worst call site in the product, and a Select would only
	 * repaint it.
	 *
	 * The value carrier is deliberately not bits-ui's own hidden input. A combobox that
	 * posts is paired with `ui/native-fallback` at its call site, and that component
	 * owns the "exactly one carrier, whichever mode we are in" rule; passing `name`
	 * here would put a second input with the same name into the SSR output, which is
	 * the markup a reader with scripting off actually gets. So `name` is not a prop:
	 * a call site that posts renders `NativeFallback` beside this and marks the wrapper
	 * `data-js-only`, and a call site that only feeds client-side state renders neither.
	 *
	 * G1: reading-room tokens only, so both palettes are the same markup. G2: the
	 * trigger and the option rows inherit the serif `--font-sans`, and `tabular-nums`
	 * is on the option rows because entity and session names routinely carry a number.
	 */
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils/cn.js';
	import { tick } from 'svelte';
	import type { ComponentProps } from 'svelte';

	let {
		id,
		value = $bindable(),
		options,
		/** Shown on the trigger when nothing is chosen yet. */
		placeholder,
		searchPlaceholder,
		emptyText,
		disabled = false,
		labelledby,
		ariaLabel,
		onchange,
		class: className,
		contentProps
	}: {
		id?: string;
		value: string | null;
		options: readonly ComboboxOption[];
		placeholder: string;
		searchPlaceholder: string;
		emptyText: string;
		disabled?: boolean;
		labelledby?: string;
		ariaLabel?: string;
		onchange?: (value: string | null) => void;
		class?: string;
		contentProps?: WithoutChildrenOrChild<ComponentProps<typeof Popover.Content>>;
	} = $props();

	let open = $state(false);
	let triggerRef = $state<HTMLButtonElement | null>(null);

	const selected = $derived(options.find((option) => option.value === value));

	/** Closing returns focus to the trigger, which is what a keyboard user expects and
	 * what bits-ui cannot do for us here: the Command item's own select handler runs
	 * before the popover has torn its focus scope down. */
	async function choose(next: string) {
		value = next;
		onchange?.(next);
		open = false;
		await tick();
		triggerRef?.focus();
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		bind:ref={triggerRef}
		{id}
		{disabled}
		aria-labelledby={labelledby}
		aria-label={ariaLabel}
		data-slot="combobox-trigger"
		class={cn(
			'flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-1 text-left text-sm transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50',
			className
		)}
	>
		<span class={cn('truncate', selected ? 'text-ink' : 'text-muted-foreground')}>
			{selected?.label ?? placeholder}
		</span>
		<ChevronsUpDownIcon class="pointer-events-none size-4 shrink-0 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class="w-(--bits-popover-anchor-width) min-w-56 p-0"
		{...contentProps}
	>
		<Command.Root>
			<Command.Input placeholder={searchPlaceholder} />
			<Command.List>
				<Command.Empty>{emptyText}</Command.Empty>
				{#each options as option (option.value)}
					<Command.Item
						value={option.value}
						keywords={[option.label, ...(option.keywords ?? [])]}
						onSelect={() => choose(option.value)}
						class="tabular-nums [&_.cn-command-item-indicator]:hidden"
					>
						<CheckIcon
							class={cn('size-4 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')}
						/>
						<span class="truncate">{option.label}</span>
						{#if option.hint}
							<span class="ml-auto text-xs text-muted">{option.hint}</span>
						{/if}
					</Command.Item>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
