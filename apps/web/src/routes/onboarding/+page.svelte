<script lang="ts">
	/**
	 * D7 = A's screen 1+2 combined (signup already happened at /auth/sign-up): name the
	 * universe, then pick import (the default, continues at /onboarding/import) or the
	 * pre-indexed fallback for a GM with nothing to import yet. One field, two submit
	 * buttons routing to different form actions via `formaction`.
	 */
	import { messages } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let t = $derived(messages(data.locale).import.start);

	// svelte-ignore state_referenced_locally
	let name = $state(form?.name ?? '');
</script>

<svelte:head>
	<title>{t.headTitle}</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<h1 class="text-2xl font-semibold text-ink">{t.heading}</h1>
	<p class="text-sm text-ink-2">
		{t.description}
	</p>

	{#if form?.error}
		<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
	{/if}

	<form method="POST" class="flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<label for="name" class="text-sm font-medium text-ink">{t.nameLabel}</label>
			<input
				id="name"
				name="name"
				type="text"
				bind:value={name}
				placeholder={t.namePlaceholder}
				required
				class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
			/>
		</div>

		<div class="mt-2 flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
			<p class="text-sm font-medium text-ink">{t.importCard.heading}</p>
			<p class="text-sm text-ink-2">
				{t.importCard.description}
			</p>
			<button
				type="submit"
				formaction="?/import"
				class="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:opacity-90"
			>
				{t.importCard.cta}
			</button>
		</div>

		<div class="flex flex-col gap-3 rounded-lg border border-line bg-panel-2 p-4">
			<p class="text-sm font-medium text-ink">{t.preindexedCard.heading}</p>
			{#if data.preIndexedBase}
				<p class="text-sm text-ink-2">
					{t.preindexedCard.description(data.preIndexedBase.name)}
				</p>
				<button
					type="submit"
					formaction="?/preindexed"
					class="self-start rounded-md border border-line-2 bg-panel px-4 py-2 text-sm font-medium text-ink hover:border-accent"
				>
					{t.preindexedCard.cta(data.preIndexedBase.name)}
				</button>
			{:else}
				<p class="text-sm text-muted">
					{t.preindexedCard.notConfigured}
				</p>
			{/if}
		</div>
	</form>
</main>
