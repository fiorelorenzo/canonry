<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let saving = $state(false);

	const t = $derived(messages(data.locale).settings);

	const OPTIONS = $derived([
		{ value: 'light', label: t.appearance.light },
		{ value: 'dark', label: t.appearance.dark },
		{ value: 'system', label: t.appearance.system }
	] as const);

	let selected = $derived(form?.themePreference ?? data.themePreference);
</script>

<svelte:head>
	<title>{t.appearance.title}: Canonry</title>
</svelte:head>

<form
	method="POST"
	class="mt-6 flex flex-col gap-3"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update();
			saving = false;
		};
	}}
>
	<fieldset class="flex flex-col gap-2">
		<legend class="sr-only">{t.appearance.title}</legend>
		{#each OPTIONS as option (option.value)}
			<label
				class="flex items-center gap-3 rounded-md border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-bg"
			>
				<input
					type="radio"
					name="preference"
					value={option.value}
					checked={selected === option.value}
					class="accent-[var(--color-accent)]"
				/>
				<span class="text-sm text-ink">{option.label}</span>
			</label>
		{/each}
	</fieldset>

	<div>
		<Button type="submit" disabled={saving}
			>{saving ? t.appearance.saving : t.appearance.save}</Button
		>
	</div>

	{#if form?.error}
		<p class="text-sm text-danger">{form.error}</p>
	{/if}
</form>
