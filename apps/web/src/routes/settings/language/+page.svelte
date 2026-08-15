<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { LOCALE_NAMES, LOCALES, messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).settings);

	// Falls back to the negotiated active locale when nothing has been explicitly saved
	// yet, so the radio starts on whatever Accept-Language already picked rather than on
	// nothing - saving without changing anything is still a real, explicit choice.
	let selected = $derived(
		form?.accountLocale ?? (data.signedIn ? data.accountLocale : null) ?? data.locale
	);

	let saved = $state(false);
</script>

<svelte:head>
	<title>{t.language.title}: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">{t.backToUniverses}</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">{t.language.title}</h1>
	<p class="mt-2 max-w-xl text-sm text-ink-2">
		{t.language.description}
	</p>

	{#if !data.signedIn}
		<p class="mt-6 text-sm text-ink-2">
			<a href={resolve('/auth/sign-in')} class="text-accent hover:underline"
				>{t.language.signInLink}</a
			>
			{t.language.signInPrompt}
		</p>
	{:else}
		<form
			method="POST"
			class="mt-6 flex flex-col gap-3"
			use:enhance={() => {
				saved = false;
				return async ({ update }) => {
					await update();
					saved = true;
				};
			}}
		>
			<fieldset class="flex flex-col gap-2">
				<legend class="sr-only">{t.language.title}</legend>
				{#each LOCALES as loc (loc)}
					<label
						class="flex items-center gap-3 rounded-md border border-line px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-bg"
					>
						<input
							type="radio"
							name="locale"
							value={loc}
							checked={selected === loc}
							class="accent-[var(--color-accent)]"
						/>
						<span class="text-sm text-ink">{LOCALE_NAMES[loc]}</span>
					</label>
				{/each}
			</fieldset>

			<button
				type="submit"
				class="mt-2 w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:bg-accent-ink"
			>
				{t.language.save}
			</button>

			{#if saved && !form?.error}
				<p class="text-sm text-ink-2">{t.language.saved}</p>
			{/if}
			{#if form?.error}
				<p class="text-sm text-danger">{form.error}</p>
			{/if}
		</form>
	{/if}
</main>
