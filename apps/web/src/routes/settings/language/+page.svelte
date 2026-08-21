<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { LOCALE_NAMES, LOCALES, messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).settings);
	const tDocs = $derived(messages(data.locale).docsLanguages);

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

<p class="mt-4 max-w-xl text-sm text-ink-2">
	{t.language.learnMorePrompt}
	<a href={resolve('/docs/languages')} class="text-accent hover:underline">{tDocs.title}</a>
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

		<div>
			<Button type="submit">{t.language.save}</Button>
		</div>

		{#if saved && !form?.error}
			<p class="text-sm text-ink-2">{t.language.saved}</p>
		{/if}
		{#if form?.error}
			<p class="text-sm text-danger">{form.error}</p>
		{/if}
	</form>
{/if}
