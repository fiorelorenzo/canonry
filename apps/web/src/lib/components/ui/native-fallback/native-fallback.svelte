<script lang="ts" module>
	export type NativeFallbackOption = { value: string; label: string };
</script>

<script lang="ts">
	/**
	 * Issue #286's first obligation, made into one mechanism instead of ten hand-written
	 * ones: "a native `<select>` inside a progressively enhanced form posts; a popover
	 * does not", so a form that has to keep working without JavaScript needs a value
	 * carrier in both modes and never two at once.
	 *
	 * This renders exactly one of them:
	 *
	 * - Scripting on: a hidden input carrying `value`, added after mount. Not rendered
	 *   during SSR on purpose, because SSR output is also what a reader with scripting
	 *   off receives, and an SSR'd hidden input would post alongside the `<noscript>`
	 *   select below, giving the action two values for one field.
	 * - Scripting off: a real `<select>` inside `<noscript>`, which the parser leaves as
	 *   inert text whenever scripting is on, so it is a form control only in the mode
	 *   that needs it.
	 *
	 * The enhanced control the fallback stands in for marks itself `data-js-only`, which
	 * `app.html`'s own `<noscript>` block hides. That rule lives there rather than here
	 * because it has to apply before the first paint, and because a `<style>` repeated
	 * per instance would be the same declaration many times over.
	 *
	 * A call site that deliberately stops being progressive does not use this component
	 * at all, and says so in a comment: see `MergeRelationTypesDialog.svelte` (its form
	 * lives inside a dialog that cannot open without JavaScript) and the two table
	 * surfaces, whose forms submit through `fetch` and never had an action to post to.
	 */
	import { onMount } from 'svelte';

	let {
		name,
		value,
		options,
		required = false,
		disabled = false,
		label
	}: {
		name: string;
		value: string | null | undefined;
		options: readonly NativeFallbackOption[];
		required?: boolean;
		/** #383: a call site whose enhanced control can be disabled (a permission gate,
		 * not a busy flag - see `LanguageControl.svelte`) needs its `<noscript>` fallback
		 * to refuse the same submission, since a reader with scripting off has no other
		 * signal that the field is not theirs to change. */
		disabled?: boolean;
		/** Accessible name for the fallback select, which has no visible label of its own. */
		label: string;
	} = $props();

	let scripted = $state(false);
	onMount(() => {
		scripted = true;
	});
</script>

{#if scripted}
	<input type="hidden" {name} value={value ?? ''} />
{:else}
	<noscript>
		<select
			{name}
			{required}
			{disabled}
			aria-label={label}
			class="h-9 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-sm text-ink"
		>
			{#each options as option (option.value)}
				<option value={option.value} selected={option.value === value}>{option.label}</option>
			{/each}
		</select>
	</noscript>
{/if}
