<script lang="ts" module>
	export type SegmentedOption = {
		value: string;
		label: string;
		/** A second line under the label, for a segment that needs a word of its own. */
		hint?: string;
	};
</script>

<script lang="ts">
	/**
	 * Decision O4 = B (docs/ux/DECISIONS.md, "Round ten"), issue #286: a binary or
	 * ternary state gets a segmented control, and this is it. The other two shapes of
	 * that decision are `ui/select` (a vocabulary the product ships) and `ui/combobox`
	 * (a list drawn from the GM's own data).
	 *
	 * This is the one control in the set that is not shadcn-svelte, and the reason is
	 * in the markup rather than left to taste: it is a group of native
	 * `<input type="radio">` elements, so arrow-key roving, the focus ring, form reset
	 * and, above all, submitting the chosen value all come from the platform. I9 = C
	 * reserves components of our own for where the control layer has no answer, and
	 * shadcn-svelte's nearest shapes (RadioGroup, ToggleGroup) are both bits-ui widgets
	 * built out of buttons: they need JavaScript to carry a value at all, which is
	 * exactly what #286's first obligation makes every call site account for. A native
	 * radio group has nothing to account for.
	 *
	 * Each radio is nested inside its own label rather than sitting next to it, because
	 * Tailwind's `peer-checked:` compiles to a general sibling combinator: with several
	 * pairs in one flex row, checking the first segment would paint every segment after
	 * it. `has-checked:` scopes the same styling to the one label that contains the
	 * checked input.
	 *
	 * G1: every colour is a reading-room token, so the dark palette is this same markup
	 * under `[data-theme='dark']` rather than a second set of classes. G2: labels
	 * inherit `--font-sans`, which is the serif stack (routes/layout.css), and
	 * `tabular-nums` keeps a segment from resizing when its label is a number.
	 */
	import { cn } from '$lib/utils/cn.js';

	let {
		name,
		value = $bindable(),
		options,
		disabled = false,
		/** id of the element that names the group, for `aria-labelledby`. */
		labelledby,
		ariaLabel,
		onchange,
		class: className
	}: {
		name: string;
		value: string;
		options: readonly SegmentedOption[];
		disabled?: boolean;
		labelledby?: string;
		ariaLabel?: string;
		onchange?: (value: string) => void;
		class?: string;
	} = $props();
</script>

<!-- `role="radiogroup"` supplies the accessible name and the grouping only: the
     children are real radios, so their roles and their checked state are the
     platform's own. -->
<div
	role="radiogroup"
	aria-labelledby={labelledby}
	aria-label={ariaLabel}
	data-slot="segmented"
	class={cn(
		'inline-flex flex-wrap items-stretch gap-px rounded-md border border-input bg-input/30 p-px text-body',
		className
	)}
>
	{#each options as option (option.value)}
		<label
			data-slot="segmented-item"
			data-state={value === option.value ? 'on' : 'off'}
			class="flex cursor-pointer flex-col justify-center rounded-sm px-2.5 py-1 text-center text-ink-2 tabular-nums transition-colors select-none hover:text-ink has-checked:bg-panel has-checked:text-ink has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50"
		>
			<input
				type="radio"
				id={`${name}-${option.value}`}
				{name}
				{disabled}
				value={option.value}
				checked={value === option.value}
				onchange={() => {
					value = option.value;
					onchange?.(option.value);
				}}
				class="sr-only"
			/>
			{option.label}
			{#if option.hint}
				<span class="text-label text-muted">{option.hint}</span>
			{/if}
		</label>
	{/each}
</div>
