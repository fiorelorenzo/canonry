<script lang="ts">
	/**
	 * Issue #221's sibling to ProviderSelect.svelte in this directory: the image price
	 * table renders one of these per row, right next to the amount input, so an admin
	 * enters the number a provider publishes without converting it by hand first. Offered
	 * currencies come from `currencies` (ultimately `CURRENCIES`, `@canonry/ai`) rather
	 * than being hardcoded here, so this can never offer one the euro conversion cannot
	 * handle.
	 */
	import * as Select from '$lib/components/ui/select';

	let {
		id,
		currencies,
		value: initialValue,
		invalid = false
	}: {
		id: string;
		currencies: readonly string[];
		value: string | undefined;
		invalid?: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(initialValue ?? currencies[0]);
</script>

<Select.Root type="single" name="currency" bind:value>
	<Select.Trigger {id} aria-invalid={invalid} class="w-20">
		{value}
	</Select.Trigger>
	<Select.Content>
		{#each currencies as currency (currency)}
			<Select.Item value={currency} label={currency}>{currency}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
