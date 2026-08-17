<script lang="ts">
	/**
	 * Issue #155: routes/admin/models/+page.svelte's text-model table renders one of
	 * these per purpose row, each inside its own <form>. A shadcn `Select` needs
	 * somewhere to hold "what's currently highlighted in the trigger" between opens,
	 * and a `{#each}` block in the page can't declare that state itself - so each row
	 * gets its own tiny component instance, seeded once from the row's computed default
	 * the same way entry/LanguageControl.svelte's `choice` seeds from its props.
	 */
	import * as Select from '$lib/components/ui/select';

	let {
		id,
		providers,
		value: initialValue,
		invalid = false
	}: {
		id: string;
		providers: readonly string[];
		value: string | undefined;
		invalid?: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(initialValue ?? providers[0]);
</script>

<Select.Root type="single" name="provider" bind:value>
	<Select.Trigger {id} aria-invalid={invalid} class="w-32">
		{value}
	</Select.Trigger>
	<Select.Content>
		{#each providers as provider (provider)}
			<Select.Item value={provider} label={provider}>{provider}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
