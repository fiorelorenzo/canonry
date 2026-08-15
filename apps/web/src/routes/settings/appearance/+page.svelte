<script lang="ts">
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">{t.backToUniverses}</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">{t.appearance.title}</h1>
	<p class="mt-2 text-sm text-ink-2">
		{t.appearance.description}
	</p>

	<form method="POST" class="mt-6 flex flex-col gap-3">
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

		<button
			type="submit"
			class="mt-2 w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:bg-accent-ink"
		>
			{t.appearance.save}
		</button>

		{#if form?.error}
			<p class="text-sm text-danger">{form.error}</p>
		{/if}
	</form>
</main>
