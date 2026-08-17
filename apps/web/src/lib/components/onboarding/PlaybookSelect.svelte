<script lang="ts">
	/**
	 * Issue #155: the playbook picker on the `confirm` stage of onboarding/import's
	 * +page.svelte. That stage is one branch of a `{#if}/{:else if}` chain keyed on
	 * `form.stage`, so this component mounts fresh exactly when the branch first
	 * appears - `playbookId` seeds local state once, the same shape as
	 * entry/LanguageControl.svelte's `choice`, without fighting `form`'s cross-stage
	 * union type at the page's own top level.
	 */
	import * as Select from '$lib/components/ui/select';

	let {
		playbookId,
		playbookIds,
		playbookLabels
	}: {
		playbookId: string;
		playbookIds: readonly string[];
		playbookLabels: Record<string, string>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(playbookId);
</script>

<Select.Root type="single" name="playbookId" bind:value>
	<Select.Trigger id="playbookId" class="w-60">
		{playbookLabels[value]}
	</Select.Trigger>
	<Select.Content>
		{#each playbookIds as id (id)}
			<Select.Item value={id} label={playbookLabels[id]}>{playbookLabels[id]}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
